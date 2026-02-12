import type * as Party from "partykit/server";
import type {
  PictionaryState,
  PictionaryPlayer,
  PublicPictionaryPlayer,
  PublicPictionaryState,
  DrawStroke,
  UnifiedClientMessage,
} from "../../src/types.js";
import { PICTIONARY_WORDS } from "../../src/games/pictionary/words.js";

const ROUND_TIME = 60; // seconds
const POINTS_DRAWER = 1;
const POINTS_GUESSER = 2;

export class PictionaryGameHandler {
  state: PictionaryState;

  constructor() {
    this.state = this.createInitialState();
  }

  private createInitialState(): PictionaryState {
    return {
      phase: "lobby",
      players: [],
      currentWord: "",
      currentDrawerId: null,
      strokes: [],
      roundTimeLeft: ROUND_TIME,
      roundNumber: 0,
      totalRounds: 0, // Will be set to players.length when game starts
      guesses: [],
      wordChoices: [],
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

  getPlayerByToken(token: string): PictionaryPlayer | null {
    return this.state.players.find(p => p.sessionToken === token) ?? null;
  }

  updatePlayerId(token: string, newId: string): void {
    const player = this.state.players.find(p => p.sessionToken === token);
    if (!player) return;

    const previousId = player.id;
    player.id = newId;

    if (this.state.currentDrawerId === previousId) {
      this.state.currentDrawerId = newId;
    }

    this.state.guesses = this.state.guesses.map(guess =>
      guess.playerId === previousId
        ? { ...guess, playerId: newId }
        : guess
    );
  }

  addPlayer(id: string, name: string, sessionToken: string): void {
    this.state.players.push({
      id,
      name,
      sessionToken,
      score: 0,
      isDrawing: false,
    });
  }

  handleDisconnect(playerId: string): void {
    const index = this.state.players.findIndex(p => p.id === playerId);
    if (index !== -1) {
      this.state.players.splice(index, 1);
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
      
      case "pick-word":
        if ("word" in msg) {
          this.pickWord(sender.id, msg.word);
        }
        break;
      
      case "draw":
        if ("stroke" in msg) {
          this.addStroke(sender.id, msg.stroke, room);
        }
        break;
      
      case "clear-canvas":
        this.clearCanvas(sender.id, room);
        break;
      
      case "guess":
        if ("text" in msg) {
          this.handleGuess(sender.id, msg.text, room);
        }
        break;
      
      case "next-round":
        this.nextRound();
        break;
    }
  }

  private startGame(): void {
    if (this.state.players.length < 2) return;
    
    this.state.totalRounds = this.state.players.length;
    this.state.roundNumber = 1;
    this.startPickingPhase();
  }

  private startPickingPhase(): void {
    const drawerIndex = (this.state.roundNumber - 1) % this.state.players.length;
    const drawer = this.state.players[drawerIndex];
    
    // Reset all players' drawing status
    for (const player of this.state.players) {
      player.isDrawing = player.id === drawer.id;
    }
    
    this.state.currentDrawerId = drawer.id;
    this.state.phase = "picking";
    this.state.strokes = [];
    this.state.guesses = [];
    this.state.wordChoices = this.getRandomWords(3);
  }

  private pickWord(playerId: string, word: string): void {
    if (this.state.phase !== "picking") return;
    if (playerId !== this.state.currentDrawerId) return;
    if (!this.state.wordChoices.includes(word)) return;
    
    this.state.currentWord = word;
    this.state.phase = "drawing";
    this.state.roundTimeLeft = ROUND_TIME;
  }

  private addStroke(playerId: string, stroke: DrawStroke, room: Party.Room): void {
    if (this.state.phase !== "drawing") return;
    if (playerId !== this.state.currentDrawerId) return;
    
    this.state.strokes.push(stroke);
    
    // Broadcast stroke to all players except drawer
    for (const conn of room.getConnections()) {
      if (conn.id !== this.state.currentDrawerId) {
        conn.send(JSON.stringify({ type: "draw", stroke }));
      }
    }
  }

  private clearCanvas(playerId: string, room: Party.Room): void {
    if (this.state.phase !== "drawing") return;
    if (playerId !== this.state.currentDrawerId) return;
    
    this.state.strokes = [];
    room.broadcast(JSON.stringify({ type: "clear-canvas" }));
  }

  private handleGuess(playerId: string, text: string, room: Party.Room): void {
    if (this.state.phase !== "drawing") return;
    if (playerId === this.state.currentDrawerId) return; // Drawer can't guess
    
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return;
    
    const normalizedGuess = text.toLowerCase().trim();
    const normalizedWord = this.state.currentWord.toLowerCase().trim();
    const correct = normalizedGuess === normalizedWord;
    
    this.state.guesses.push({
      playerId,
      name: player.name,
      guess: text,
      correct,
    });
    
    if (correct) {
      // Award points
      player.score += POINTS_GUESSER;
      const drawer = this.state.players.find(p => p.id === this.state.currentDrawerId);
      if (drawer) drawer.score += POINTS_DRAWER;
      
      // End the round
      this.endRound(room);
    } else {
      // Broadcast guess to all
      room.broadcast(JSON.stringify({
        type: "guess",
        playerId,
        name: player.name,
        guess: text,
        correct: false,
      }));
    }
  }

  private endRound(room: Party.Room): void {
    const winner = this.state.guesses.find(g => g.correct);
    
    room.broadcast(JSON.stringify({
      type: "round-end",
      word: this.state.currentWord,
      winnerId: winner?.playerId ?? null,
    }));
    
    this.state.phase = "reveal";
  }

  private nextRound(): void {
    if (this.state.roundNumber >= this.state.totalRounds) {
      this.endGame();
      return;
    }
    
    this.state.roundNumber++;
    this.startPickingPhase();
  }

  private endGame(): void {
    this.state.phase = "ended";
    // Winner is player with highest score
  }

  private getRandomWords(count: number): string[] {
    const shuffled = [...PICTIONARY_WORDS].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  private toPublicPlayer(player: PictionaryPlayer): PublicPictionaryPlayer {
    const { sessionToken: _sessionToken, ...publicPlayer } = player;
    return publicPlayer;
  }

  getStateForConnection(connId: string): object {
    const isDrawer = connId === this.state.currentDrawerId;
    
    const publicState: PublicPictionaryState = {
      phase: this.state.phase,
      players: this.state.players.map(player => this.toPublicPlayer(player)),
      currentDrawerId: this.state.currentDrawerId,
      strokes: this.state.strokes,
      roundTimeLeft: this.state.roundTimeLeft,
      roundNumber: this.state.roundNumber,
      totalRounds: this.state.totalRounds,
      guesses: this.state.guesses.map(g => ({
        ...g,
        guess: g.correct ? "Correct!" : g.guess, // Hide correct guesses from others
      })),
      wordLength: this.state.currentWord.length,
      wordChoices: isDrawer && this.state.phase === "picking" ? this.state.wordChoices : undefined,
    };
    
    return {
      type: "game-state",
      gameType: "pictionary",
      state: publicState,
      currentWord: isDrawer ? this.state.currentWord : undefined,
    };
  }
}
