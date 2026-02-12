import type * as Party from "partykit/server";
import type {
  CodenamesState,
  CodenamesPlayer,
  PublicCodenamesPlayer,
  CodenamesCard,
  CodenamesCardType,
  PublicCodenamesState,
  UnifiedClientMessage,
} from "../../src/types.js";
import { CODENAMES_WORDS } from "../../src/games/codenames/words.js";

const INITIAL_TURNS = 9;
const GREEN_CARDS = 15;
const ASSASSIN_CARDS = 3;

export class CodenamesGameHandler {
  state: CodenamesState;

  constructor() {
    this.state = this.createInitialState();
  }

  private createInitialState(): CodenamesState {
    return {
      phase: "lobby",
      players: [],
      board: [],
      currentClue: null,
      guessesRemaining: 0,
      turnsRemaining: INITIAL_TURNS,
      greenRemaining: GREEN_CARDS,
      isClueGiver: true,
      clueGiverId: null,
    };
  }

  getPlayerCount(): number {
    return this.state.players.length;
  }

  isInLobby(): boolean {
    return this.state.phase === "lobby";
  }

  isNameTaken(name: string): boolean {
    return this.state.players.some(p => p.name === name);
  }

  getPlayerByToken(token: string): CodenamesPlayer | null {
    return this.state.players.find(p => p.sessionToken === token) ?? null;
  }

  updatePlayerId(token: string, newId: string): void {
    const player = this.state.players.find(p => p.sessionToken === token);
    if (!player) return;

    const previousId = player.id;
    player.id = newId;

    if (this.state.clueGiverId === previousId) {
      this.state.clueGiverId = newId;
    }
  }

  addPlayer(id: string, name: string, sessionToken: string): void {
    this.state.players.push({
      id,
      name,
      sessionToken,
      score: 0,
    });

    if (!this.state.clueGiverId) {
      this.state.clueGiverId = id;
    }
  }

  handleDisconnect(playerId: string): void {
    const index = this.state.players.findIndex(p => p.id === playerId);
    if (index !== -1) {
      const wasClueGiver = this.state.clueGiverId === playerId;
      this.state.players.splice(index, 1);

      if (this.state.players.length === 0) {
        this.state.clueGiverId = null;
        this.state.isClueGiver = true;
        this.state.currentClue = null;
        this.state.guessesRemaining = 0;
        return;
      }

      if (wasClueGiver) {
        this.state.clueGiverId = this.state.players[index % this.state.players.length].id;
        if (!this.state.isClueGiver) {
          this.state.isClueGiver = true;
          this.state.currentClue = null;
          this.state.guessesRemaining = 0;
        }
      }
    }
  }

  pruneDisconnected(connectedIds: Set<string>): void {
    this.state.players = this.state.players.filter(p => connectedIds.has(p.id));
  }

  async handleMessage(msg: UnifiedClientMessage, sender: Party.Connection, room: Party.Room): Promise<void> {
    switch (msg.type) {
      case "start-game":
        this.startGame();
        break;
      
      case "give-clue":
        if ("word" in msg && "count" in msg) {
          this.giveClue(sender.id, msg.word, msg.count, room);
        }
        break;
      
      case "guess":
        if ("cardIndex" in msg) {
          this.handleGuess(sender.id, msg.cardIndex, room);
        }
        break;
      
      case "end-turn":
        this.endTurn(sender.id, room);
        break;
      
      case "new-game":
        this.startGame();
        break;
    }
  }

  private startGame(): void {
    if (this.state.players.length < 2) return;
    
    this.state.board = this.generateBoard();
    this.state.phase = "playing";
    this.state.turnsRemaining = INITIAL_TURNS;
    this.state.greenRemaining = GREEN_CARDS;
    this.state.isClueGiver = true;
    this.state.clueGiverId = this.state.players[0]?.id ?? null;
    this.state.currentClue = null;
    this.state.guessesRemaining = 0;
  }

  private generateBoard(): CodenamesCard[] {
    // Get 25 random words
    const shuffledWords = [...CODENAMES_WORDS].sort(() => Math.random() - 0.5);
    const words = shuffledWords.slice(0, 25);
    
    // Create card types: 15 green, 3 assassins, 7 neutral
    const types: CodenamesCardType[] = [
      ...Array(GREEN_CARDS).fill("green"),
      ...Array(ASSASSIN_CARDS).fill("assassin"),
      ...Array(25 - GREEN_CARDS - ASSASSIN_CARDS).fill("neutral"),
    ];
    
    // Shuffle types
    types.sort(() => Math.random() - 0.5);
    
    return words.map((word, i) => ({
      word,
      type: types[i],
      revealed: false,
    }));
  }

  private giveClue(senderId: string, word: string, count: number, room: Party.Room): void {
    if (this.state.phase !== "playing") return;
    if (!this.state.isClueGiver) return;
    if (senderId !== this.state.clueGiverId) return;
    if (!Number.isInteger(count) || count < 1) return;
    
    this.state.currentClue = { word: word.toUpperCase(), count };
    this.state.guessesRemaining = count + 1; // Can guess count+1 cards
    this.state.isClueGiver = false;
    
    room.broadcast(JSON.stringify({
      type: "clue-given",
      word: word.toUpperCase(),
      count,
    }));
  }

  private handleGuess(senderId: string, cardIndex: number, room: Party.Room): void {
    if (this.state.phase !== "playing") return;
    if (this.state.isClueGiver) return;
    if (senderId === this.state.clueGiverId) return;
    if (this.state.guessesRemaining <= 0) return;
    if (cardIndex < 0 || cardIndex >= 25) return;
    
    const card = this.state.board[cardIndex];
    if (card.revealed) return;
    
    card.revealed = true;
    this.state.guessesRemaining--;
    
    room.broadcast(JSON.stringify({
      type: "card-revealed",
      cardIndex,
      cardType: card.type,
    }));
    
    if (card.type === "assassin") {
      this.state.phase = "lost";
      room.broadcast(JSON.stringify({ type: "game-over", won: false }));
      return;
    }
    
    if (card.type === "green") {
      this.state.greenRemaining--;
      
      if (this.state.greenRemaining === 0) {
        this.state.phase = "won";
        room.broadcast(JSON.stringify({ type: "game-over", won: true }));
        return;
      }
    }
    
    // If neutral or ran out of guesses, end turn
    if (card.type === "neutral" || this.state.guessesRemaining === 0) {
      this.endTurn(senderId, room);
    }
  }

  private endTurn(senderId: string, room: Party.Room): void {
    if (this.state.phase !== "playing") return;
    if (this.state.isClueGiver) return;
    if (senderId === this.state.clueGiverId) return;

    this.state.turnsRemaining--;
    
    if (this.state.turnsRemaining === 0) {
      this.state.phase = "lost";
      room.broadcast(JSON.stringify({ type: "game-over", won: false }));
      return;
    }
    
    this.advanceClueGiver();
    this.state.isClueGiver = true;
    this.state.currentClue = null;
    this.state.guessesRemaining = 0;
  }

  private advanceClueGiver(): void {
    if (this.state.players.length === 0) {
      this.state.clueGiverId = null;
      return;
    }

    if (!this.state.clueGiverId) {
      this.state.clueGiverId = this.state.players[0].id;
      return;
    }

    const currentIndex = this.state.players.findIndex(
      player => player.id === this.state.clueGiverId
    );
    const nextIndex = currentIndex >= 0
      ? (currentIndex + 1) % this.state.players.length
      : 0;
    this.state.clueGiverId = this.state.players[nextIndex].id;
  }

  private toPublicPlayer(player: CodenamesPlayer): PublicCodenamesPlayer {
    const { sessionToken: _sessionToken, ...publicPlayer } = player;
    return publicPlayer;
  }

  getStateForConnection(connId: string): object {
    const publicBoard = this.state.board.map(card => ({
      word: card.word,
      revealed: card.revealed,
      type: card.revealed ? card.type : undefined,
    }));
    
    const publicState: PublicCodenamesState = {
      phase: this.state.phase,
      players: this.state.players.map(player => this.toPublicPlayer(player)),
      board: publicBoard,
      currentClue: this.state.currentClue,
      guessesRemaining: this.state.guessesRemaining,
      turnsRemaining: this.state.turnsRemaining,
      greenRemaining: this.state.greenRemaining,
    };
    
    // In Duet, show full board to clue giver
    const showFullBoard = this.state.phase === "playing"
      && this.state.isClueGiver
      && connId === this.state.clueGiverId;
    
    return {
      type: "game-state",
      gameType: "codenames",
      state: publicState,
      fullBoard: showFullBoard ? this.state.board : undefined,
    };
  }
}
