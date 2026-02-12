import type * as Party from "partykit/server";
import type { 
  GameType,
  UnifiedClientMessage,
  ServerMessage,
  Player,
  PlayerAction,
  BasePlayer
} from "../src/types.js";
import { PokerGameHandler } from "./games/poker.js";
import { PictionaryGameHandler } from "./games/pictionary.js";
import { CodenamesGameHandler } from "./games/codenames.js";
import { generateSessionToken } from "../src/session.js";
import { DEFAULT_SETTINGS } from "../src/constants.js";

type ConnectionMap = Map<string, { sessionToken: string; playerId: string }>;
const RECONNECT_GRACE_MS = 10_000;

export default class DinoGamesServer implements Party.Server {
  gameType: GameType | null = null;
  connections: ConnectionMap = new Map();
  pendingDisconnects: Map<string, ReturnType<typeof setTimeout>> = new Map();
  
  // Game handlers
  pokerHandler: PokerGameHandler | null = null;
  pictionaryHandler: PictionaryGameHandler | null = null;
  codenamesHandler: CodenamesGameHandler | null = null;

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    console.log(`Connection opened: ${conn.id}`);
    // Send room info if game type is set
    if (this.gameType) {
      conn.send(JSON.stringify({
        type: "room-info",
        gameType: this.gameType,
        playerCount: this.getPlayerCount(),
      }));
    }
  }

  async onMessage(message: string, sender: Party.Connection) {
    let msg: UnifiedClientMessage;
    try {
      msg = JSON.parse(message);
    } catch {
      sender.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
      return;
    }

    console.log(`Message from ${sender.id}:`, msg.type);

    // Handle join - this sets the game type for the room
    if (msg.type === "join") {
      await this.handleJoin(sender, msg.name, msg.gameType, msg.sessionToken);
      return;
    }

    // Route to appropriate game handler
    if (!this.gameType) {
      sender.send(JSON.stringify({ type: "error", message: "No game selected" }));
      return;
    }

    switch (this.gameType) {
      case "poker":
        await this.handlePokerMessage(msg, sender);
        break;
      case "pictionary":
        await this.handlePictionaryMessage(msg, sender);
        break;
      case "codenames":
        await this.handleCodenamesMessage(msg, sender);
        break;
    }
  }

  onClose(conn: Party.Connection) {
    console.log(`Connection closed: ${conn.id}`);
    this.scheduleDisconnect(conn.id);
  }

  // --- Join Handler ---

  private async handleJoin(
    conn: Party.Connection, 
    name: string, 
    gameType?: GameType,
    sessionToken?: string
  ) {
    const trimmedName = name.trim();

    // Check for reconnection
    if (sessionToken && this.gameType) {
      const existingPlayer = this.findPlayerByToken(sessionToken);
      if (existingPlayer) {
        this.clearPendingDisconnect(sessionToken);
        this.connections.set(conn.id, { sessionToken, playerId: conn.id });
        this.updatePlayerId(sessionToken, conn.id);
        
        conn.send(JSON.stringify({ 
          type: "welcome", 
          playerId: conn.id,
          sessionToken,
          gameType: this.gameType
        }));
        
        await this.broadcastState();
        return;
      }
    }

    // New room - set game type
    if (!this.gameType) {
      if (!gameType) {
        conn.send(JSON.stringify({ type: "error", message: "Please select a game type" }));
        return;
      }
      this.gameType = gameType;
      this.initializeGameHandler(gameType);
    }

    // Check if game allows more players
    if (!this.canAddPlayer()) {
      conn.send(JSON.stringify({ type: "error", message: "Game is full" }));
      return;
    }

    // Check if in lobby
    if (!this.isInLobby()) {
      conn.send(JSON.stringify({ type: "error", message: "Game already in progress" }));
      return;
    }

    // Check for duplicate name
    if (trimmedName && this.isNameTaken(trimmedName)) {
      conn.send(JSON.stringify({ type: "error", message: "Name already taken" }));
      return;
    }

    const newSessionToken = generateSessionToken();
    const playerName = trimmedName || `Dino${this.getPlayerCount() + 1}`;
    
    this.clearPendingDisconnect(newSessionToken);
    this.addPlayer(conn.id, playerName, newSessionToken);
    this.connections.set(conn.id, { sessionToken: newSessionToken, playerId: conn.id });

    conn.send(JSON.stringify({ 
      type: "welcome", 
      playerId: conn.id,
      sessionToken: newSessionToken,
      gameType: this.gameType
    }));

    this.room.broadcast(JSON.stringify({
      type: "player-joined",
      player: { id: conn.id, name: playerName, score: 0 }
    }));

    await this.broadcastState();
  }

  // --- Game-specific message handlers ---

  private async handlePokerMessage(msg: UnifiedClientMessage, sender: Party.Connection) {
    if (!this.pokerHandler) return;

    switch (msg.type) {
      case "start-game": {
        this.pruneDisconnectedPlayers();
        const result = await this.pokerHandler.startGame();
        if (!result.success) {
          sender.send(JSON.stringify({ type: "error", message: result.error }));
          return;
        }
        await this.broadcastState();
        break;
      }
      
      case "action": {
        const result = await this.pokerHandler.handleAction(sender.id, msg.action);
        if (!result.success) {
          sender.send(JSON.stringify({ type: "error", message: result.error }));
          return;
        }
        
        this.room.broadcast(JSON.stringify({
          type: "action-taken",
          playerId: sender.id,
          action: msg.action,
        }));

        if (result.showdown) {
          const state = this.pokerHandler.getState();
          const winners = state.players.filter(p => !p.folded);
          if (winners.length > 0) {
            // Broadcast showdown info
          }
        }
        
        await this.broadcastState();
        break;
      }
      
      case "new-hand": {
        this.pruneDisconnectedPlayers();
        const result = await this.pokerHandler.handleNewHand();
        if (!result.success) {
          sender.send(JSON.stringify({ type: "error", message: result.error }));
          return;
        }
        await this.broadcastState();
        break;
      }
    }
  }

  private async handlePictionaryMessage(msg: UnifiedClientMessage, sender: Party.Connection) {
    if (!this.pictionaryHandler) return;
    await this.pictionaryHandler.handleMessage(msg, sender, this.room);
    await this.broadcastState();
  }

  private async handleCodenamesMessage(msg: UnifiedClientMessage, sender: Party.Connection) {
    if (!this.codenamesHandler) return;
    await this.codenamesHandler.handleMessage(msg, sender, this.room);
    await this.broadcastState();
  }

  // --- Helper methods ---

  private initializeGameHandler(gameType: GameType) {
    switch (gameType) {
      case "poker":
        this.pokerHandler = new PokerGameHandler();
        break;
      case "pictionary":
        this.pictionaryHandler = new PictionaryGameHandler();
        break;
      case "codenames":
        this.codenamesHandler = new CodenamesGameHandler();
        break;
    }
  }

  private getPlayerCount(): number {
    switch (this.gameType) {
      case "poker":
        return this.pokerHandler?.getPlayerCount() ?? 0;
      case "pictionary":
        return this.pictionaryHandler?.getPlayerCount() ?? 0;
      case "codenames":
        return this.codenamesHandler?.getPlayerCount() ?? 0;
      default:
        return 0;
    }
  }

  private canAddPlayer(): boolean {
    const count = this.getPlayerCount();
    switch (this.gameType) {
      case "poker":
        return count < DEFAULT_SETTINGS.maxPlayers;
      case "pictionary":
        return count < 8;
      case "codenames":
        return count < 4;
      default:
        return false;
    }
  }

  private isInLobby(): boolean {
    switch (this.gameType) {
      case "poker":
        return this.pokerHandler?.isInLobby() ?? true;
      case "pictionary":
        return this.pictionaryHandler?.isInLobby() ?? true;
      case "codenames":
        return this.codenamesHandler?.isInLobby() ?? true;
      default:
        return true;
    }
  }

  private isNameTaken(name: string): boolean {
    switch (this.gameType) {
      case "poker":
        return this.pokerHandler?.getState().players.some(p => p.name === name) ?? false;
      case "pictionary":
        return this.pictionaryHandler?.isNameTaken(name) ?? false;
      case "codenames":
        return this.codenamesHandler?.isNameTaken(name) ?? false;
      default:
        return false;
    }
  }

  private findPlayerByToken(token: string): BasePlayer | Player | null {
    switch (this.gameType) {
      case "poker":
        return this.pokerHandler?.getPlayerByToken(token) ?? null;
      case "pictionary":
        return this.pictionaryHandler?.getPlayerByToken(token) ?? null;
      case "codenames":
        return this.codenamesHandler?.getPlayerByToken(token) ?? null;
      default:
        return null;
    }
  }

  private updatePlayerId(token: string, newId: string): void {
    switch (this.gameType) {
      case "poker": {
        const player = this.pokerHandler?.getPlayerByToken(token);
        if (player) player.id = newId;
        break;
      }
      case "pictionary":
        this.pictionaryHandler?.updatePlayerId(token, newId);
        break;
      case "codenames":
        this.codenamesHandler?.updatePlayerId(token, newId);
        break;
    }
  }

  private addPlayer(id: string, name: string, sessionToken: string): void {
    switch (this.gameType) {
      case "poker": {
        const newPlayer: Player = {
          id,
          name,
          chips: DEFAULT_SETTINGS.startingChips,
          holeCards: [],
          currentBet: 0,
          totalBetThisHand: 0,
          folded: false,
          allIn: false,
          isDealer: this.pokerHandler?.getPlayerCount() === 0,
          sessionToken,
        };
        this.pokerHandler?.addPlayer(newPlayer);
        break;
      }
      case "pictionary":
        this.pictionaryHandler?.addPlayer(id, name, sessionToken);
        break;
      case "codenames":
        this.codenamesHandler?.addPlayer(id, name, sessionToken);
        break;
    }
  }

  private handleDisconnect(playerId: string): void {
    switch (this.gameType) {
      case "poker":
        this.pokerHandler?.handleDisconnect(playerId);
        break;
      case "pictionary":
        this.pictionaryHandler?.handleDisconnect(playerId);
        break;
      case "codenames":
        this.codenamesHandler?.handleDisconnect(playerId);
        break;
    }

    this.room.broadcast(JSON.stringify({ type: "player-left", playerId }));
    void this.broadcastState();
  }

  private scheduleDisconnect(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    this.connections.delete(connectionId);
    this.clearPendingDisconnect(connection.sessionToken);

    const timeout = setTimeout(() => {
      this.finalizeDisconnect(connection.sessionToken);
    }, RECONNECT_GRACE_MS);

    this.pendingDisconnects.set(connection.sessionToken, timeout);
  }

  private clearPendingDisconnect(sessionToken: string): void {
    const timeout = this.pendingDisconnects.get(sessionToken);
    if (!timeout) return;
    clearTimeout(timeout);
    this.pendingDisconnects.delete(sessionToken);
  }

  private hasActiveConnection(sessionToken: string): boolean {
    for (const connection of this.connections.values()) {
      if (connection.sessionToken === sessionToken) {
        return true;
      }
    }
    return false;
  }

  private finalizeDisconnect(sessionToken: string): void {
    this.pendingDisconnects.delete(sessionToken);

    if (this.hasActiveConnection(sessionToken)) {
      return;
    }

    const player = this.findPlayerByToken(sessionToken);
    if (!player) return;

    this.handleDisconnect(player.id);
  }

  private pruneDisconnectedPlayers(): void {
    const connectedIds = new Set(Array.from(this.room.getConnections(), conn => conn.id));
    
    switch (this.gameType) {
      case "poker": {
        const state = this.pokerHandler?.getState();
        if (state) {
          const disconnected = state.players.filter(
            p => !connectedIds.has(p.id) && !this.pendingDisconnects.has(p.sessionToken)
          );
          for (const player of disconnected) {
            this.pokerHandler?.removePlayer(player.id);
          }
        }
        break;
      }
      case "pictionary":
        this.pictionaryHandler?.pruneDisconnected(connectedIds);
        break;
      case "codenames":
        this.codenamesHandler?.pruneDisconnected(connectedIds);
        break;
    }
  }

  private async broadcastState(): Promise<void> {
    for (const conn of this.room.getConnections()) {
      const state = this.getStateForConnection(conn.id);
      if (state) {
        conn.send(JSON.stringify(state));
      }
    }
  }

  private getStateForConnection(connId: string): object | null {
    switch (this.gameType) {
      case "poker": {
        if (!this.pokerHandler) return null;
        const publicState = this.pokerHandler.getPublicState();
        const player = this.pokerHandler.getPlayer(connId);
        const legalActions = this.pokerHandler.getLegalActionsForPlayer(connId);
        return {
          type: "game-state",
          gameType: "poker",
          state: publicState,
          yourCards: player?.holeCards,
          legalActions,
        };
      }
      case "pictionary": {
        if (!this.pictionaryHandler) return null;
        return this.pictionaryHandler.getStateForConnection(connId);
      }
      case "codenames": {
        if (!this.codenamesHandler) return null;
        return this.codenamesHandler.getStateForConnection(connId);
      }
      default:
        return null;
    }
  }
}

DinoGamesServer satisfies Party.Worker;
