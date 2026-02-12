import type * as Party from "partykit/server";
import type { 
  GameState, 
  Player, 
  PlayerAction,
  ServerMessage,
  LegalActions,
  PublicGameState
} from "../../src/types.js";
import { 
  createInitialState, 
  startNewHand, 
  applyAction, 
  advanceStreet,
  shouldAdvancePhase,
  getLegalActions,
  toPublicState,
  countActivePlayers
} from "../../src/game-state.js";
import { runShowdown, shouldAutoShowdown, runOutBoard } from "../../src/showdown.js";
import { DEFAULT_SETTINGS } from "../../src/constants.js";

export interface PokerRoomState {
  gameType: "poker";
  state: GameState;
}

export class PokerGameHandler {
  state: GameState;

  constructor() {
    this.state = createInitialState();
  }

  getState(): GameState {
    return this.state;
  }

  addPlayer(player: Player): void {
    this.state.players.push(player);
  }

  removePlayer(playerId: string): void {
    const removedIndex = this.state.players.findIndex(p => p.id === playerId);
    if (removedIndex === -1) return;

    const players = [...this.state.players];
    players.splice(removedIndex, 1);

    let dealerIndex = this.state.dealerIndex;
    if (players.length === 0) {
      dealerIndex = 0;
    } else if (removedIndex < dealerIndex) {
      dealerIndex -= 1;
    } else if (removedIndex === dealerIndex) {
      dealerIndex = dealerIndex % players.length;
    }

    let activePlayerIndex = this.state.activePlayerIndex;
    if (players.length === 0) {
      activePlayerIndex = 0;
    } else if (removedIndex < activePlayerIndex) {
      activePlayerIndex -= 1;
    } else if (removedIndex === activePlayerIndex) {
      activePlayerIndex = activePlayerIndex % players.length;
    }

    let lastRaiserIndex = this.state.lastRaiserIndex;
    if (players.length === 0) {
      lastRaiserIndex = -1;
    } else if (lastRaiserIndex >= 0) {
      if (removedIndex < lastRaiserIndex) {
        lastRaiserIndex -= 1;
      } else if (removedIndex === lastRaiserIndex) {
        lastRaiserIndex = -1;
      }
    }

    const normalizedPlayers = players.map((player, index) => ({
      ...player,
      isDealer: players.length > 0 && index === dealerIndex,
    }));

    this.state = {
      ...this.state,
      players: normalizedPlayers,
      dealerIndex,
      activePlayerIndex,
      lastRaiserIndex,
    };
  }

  getPlayerCount(): number {
    return this.state.players.length;
  }

  isInLobby(): boolean {
    return this.state.phase === "lobby";
  }

  getPlayer(playerId: string): Player | undefined {
    return this.state.players.find(p => p.id === playerId);
  }

  getPlayerByToken(token: string): Player | undefined {
    return this.state.players.find(p => p.sessionToken === token);
  }

  async startGame(): Promise<{ success: boolean; error?: string }> {
    if (this.state.phase !== "lobby") {
      return { success: false, error: "Game already started" };
    }

    if (this.state.players.length < DEFAULT_SETTINGS.minPlayers) {
      return { success: false, error: `Need at least ${DEFAULT_SETTINGS.minPlayers} players` };
    }

    this.state = startNewHand(this.state);
    return { success: true };
  }

  async handleAction(
    playerId: string, 
    action: PlayerAction
  ): Promise<{ success: boolean; error?: string; showdown?: boolean }> {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, error: "Not in game" };
    }

    if (this.state.players[this.state.activePlayerIndex]?.id !== playerId) {
      return { success: false, error: "Not your turn" };
    }

    if (this.state.phase === "lobby" || this.state.phase === "showdown") {
      return { success: false, error: "Cannot act now" };
    }

    const legalActions = getLegalActions(this.state);
    if (!this.isLegalAction(action, legalActions)) {
      return { success: false, error: "Illegal action" };
    }

    this.state = applyAction(this.state, playerId, action);

    const showdownResult = await this.checkPhaseAdvancement();
    return { success: true, showdown: showdownResult.showdown };
  }

  async handleNewHand(): Promise<{ success: boolean; error?: string }> {
    if (this.state.phase !== "showdown") {
      return { success: false, error: "Hand not complete" };
    }

    // Remove busted players
    this.state.players = this.state.players.filter(p => p.chips > 0);

    if (this.state.players.length < DEFAULT_SETTINGS.minPlayers) {
      this.state = {
        ...createInitialState(),
        players: this.state.players,
      };
    } else {
      this.state = startNewHand(this.state);
    }

    return { success: true };
  }

  handleDisconnect(playerId: string): void {
    const playerIndex = this.state.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;

    if (this.state.phase === "lobby" || this.state.phase === "showdown") {
      this.removePlayer(playerId);
      return;
    }

    const disconnectedPlayer = this.state.players[playerIndex];
    if (disconnectedPlayer.folded || disconnectedPlayer.allIn) return;

    if (playerIndex === this.state.activePlayerIndex) {
      this.state = applyAction(this.state, disconnectedPlayer.id, { type: "fold" });
    } else {
      const players = [...this.state.players];
      players[playerIndex] = { ...players[playerIndex], folded: true };
      this.state = { ...this.state, players };
    }
  }

  private isLegalAction(action: PlayerAction, legal: LegalActions): boolean {
    switch (action.type) {
      case "fold": return legal.canFold;
      case "check": return legal.canCheck;
      case "call": return legal.canCall;
      case "raise":
        if (!legal.canRaise) return false;
        if (action.amount === undefined) return true;
        return Number.isFinite(action.amount) && action.amount === legal.minRaise;
      case "all-in": return legal.canAllIn;
      default: return false;
    }
  }

  private async checkPhaseAdvancement(): Promise<{ showdown: boolean; results?: unknown }> {
    if (countActivePlayers(this.state) <= 1) {
      const showdownResult = await this.runShowdown();
      return { showdown: true, results: showdownResult };
    }

    if (shouldAdvancePhase(this.state)) {
      if (shouldAutoShowdown(this.state)) {
        this.state = runOutBoard(this.state);
        const showdownResult = await this.runShowdown();
        return { showdown: true, results: showdownResult };
      }

      if (this.state.phase === "river") {
        const showdownResult = await this.runShowdown();
        return { showdown: true, results: showdownResult };
      } else {
        this.state = advanceStreet(this.state);
      }
    }

    return { showdown: false };
  }

  private async runShowdown() {
    const { results, winnings, updatedPlayers } = await runShowdown(this.state);
    
    this.state = {
      ...this.state,
      phase: "showdown",
      players: updatedPlayers,
    };

    return { results, winnings };
  }

  getPublicState(): PublicGameState {
    return toPublicState(this.state);
  }

  getLegalActionsForPlayer(playerId: string): LegalActions | undefined {
    const player = this.state.players.find(p => p.id === playerId);
    if (player && this.state.players[this.state.activePlayerIndex]?.id === playerId) {
      return getLegalActions(this.state);
    }
    return undefined;
  }
}
