// Available game types
export type GameType = "poker" | "pictionary" | "codenames";

// Game phases - state machine states (poker)
export type GamePhase = 
  | "lobby"      // Waiting for players, game not started
  | "preflop"    // Cards dealt, first betting round
  | "flop"       // 3 community cards revealed
  | "turn"       // 4th community card
  | "river"      // 5th community card
  | "showdown";  // Reveal hands, determine winner

// Pictionary phases
export type PictionaryPhase = 
  | "lobby"
  | "picking"    // Drawer is picking a word
  | "drawing"    // Active drawing round
  | "reveal"     // Show the word
  | "ended";

// Codenames phases
export type CodenamesPhase =
  | "lobby"
  | "playing"    // Game in progress
  | "won"
  | "lost";

// Base player info (shared across games)
export interface BasePlayer {
  id: string;
  name: string;
  sessionToken: string;
  score: number;
}

// Card representation
export interface Card {
  rank: Rank;
  suit: Suit;
}

// Standard poker ranks (2-14, where 14 = Ace)
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

// Suits mapped to dino clans
export type Suit = "spades" | "hearts" | "diamonds" | "clubs";

// Player actions
export type ActionType = "fold" | "check" | "call" | "raise" | "all-in";

export interface PlayerAction {
  type: ActionType;
  amount?: number; // For raise/call/all-in
}

// Player state
export interface Player {
  id: string;           // Connection ID
  name: string;
  chips: number;        // Current chip count (Amber Nuggets)
  holeCards: Card[];    // 2 private cards (only sent to this player)
  currentBet: number;   // Amount bet this street
  totalBetThisHand: number; // Total bet this hand (for side pots)
  folded: boolean;
  allIn: boolean;
  isDealer: boolean;
  sessionToken: string; // For reconnection
}

// Public player info (sent to all players)
export interface PublicPlayer {
  id: string;
  name: string;
  chips: number;
  currentBet: number;
  folded: boolean;
  allIn: boolean;
  isDealer: boolean;
  hasCards: boolean;    // Whether they have hole cards (don't reveal which)
}

// Legal actions a player can take on their turn
export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaise: number;
  maxRaise: number;
  canAllIn: boolean;
  allInAmount: number;
}

// Pot structure (for side pots)
export interface Pot {
  amount: number;
  eligiblePlayerIds: string[]; // Players who can win this pot
}

// Full game state (server-side)
export interface GameState {
  phase: GamePhase;
  players: Player[];
  communityCards: Card[];
  pots: Pot[];             // Main pot + side pots
  currentBet: number;      // Current bet to match this street
  dealerIndex: number;     // Index of dealer in players array
  activePlayerIndex: number; // Whose turn it is
  lastRaiserIndex: number; // Who raised last (for round completion)
  raisesThisStreet: number; // Count raises (max 3 in fixed-limit)
  deck: Card[];            // Remaining cards in deck
  smallBlind: number;
  bigBlind: number;
  streetBetSize: number;   // 1 for preflop/flop, 2 for turn/river
}

// Public game state (sent to clients)
export interface PublicGameState {
  phase: GamePhase;
  players: PublicPlayer[];
  communityCards: Card[];
  pots: Pot[];
  currentBet: number;
  dealerIndex: number;
  activePlayerIndex: number;
  smallBlind: number;
  bigBlind: number;
}

// Messages from client to server
export type ClientMessage =
  | { type: "join"; name: string; sessionToken?: string }
  | { type: "start-game" }
  | { type: "action"; action: PlayerAction }
  | { type: "new-hand" };

// Messages from server to client
export type ServerMessage =
  | { type: "welcome"; playerId: string; sessionToken: string }
  | { type: "error"; message: string }
  | { type: "game-state"; state: PublicGameState; yourCards?: Card[]; legalActions?: LegalActions }
  | { type: "player-joined"; player: PublicPlayer }
  | { type: "player-left"; playerId: string }
  | { type: "action-taken"; playerId: string; action: PlayerAction }
  | { type: "showdown"; results: ShowdownResult[] }
  | { type: "hand-complete"; winnerId: string; winnerName: string; handName: string; dinoHandName: string; potAmount: number };

// Showdown result for each player
export interface ShowdownResult {
  playerId: string;
  name: string;
  holeCards: Card[];
  handName: string;      // e.g., "Full House"
  dinoHandName: string;  // e.g., "Herd + Hunter"
  handRank: number;      // For comparison
  isWinner: boolean;
  potWon: number;
}

// Hand evaluation result
export interface HandEvaluation {
  handName: string;
  dinoHandName: string;
  rank: number;         // Higher is better
  cards: Card[];        // The 5 cards that make the hand
}

// ============================================
// PICTIONARY TYPES
// ============================================

export interface PictionaryPlayer extends BasePlayer {
  isDrawing: boolean;
}

export type PublicPictionaryPlayer = Omit<PictionaryPlayer, "sessionToken">;

export interface DrawStroke {
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
}

export interface PictionaryState {
  phase: PictionaryPhase;
  players: PictionaryPlayer[];
  currentWord: string;           // Only shown to drawer
  currentDrawerId: string | null;
  strokes: DrawStroke[];
  roundTimeLeft: number;         // Seconds
  roundNumber: number;
  totalRounds: number;
  guesses: Array<{ playerId: string; name: string; guess: string; correct: boolean }>;
  wordChoices: string[];         // 3 options for drawer to pick from
}

export interface PublicPictionaryState {
  phase: PictionaryPhase;
  players: PublicPictionaryPlayer[];
  currentDrawerId: string | null;
  strokes: DrawStroke[];
  roundTimeLeft: number;
  roundNumber: number;
  totalRounds: number;
  guesses: Array<{ playerId: string; name: string; guess: string; correct: boolean }>;
  wordLength: number;            // Hint: number of characters
  wordChoices?: string[];        // Only sent to drawer during picking phase
}

// Pictionary messages
export type PictionaryClientMessage =
  | { type: "join"; name: string; gameType: "pictionary"; sessionToken?: string }
  | { type: "start-game" }
  | { type: "pick-word"; word: string }
  | { type: "draw"; stroke: DrawStroke }
  | { type: "clear-canvas" }
  | { type: "guess"; text: string }
  | { type: "next-round" };

export type PictionaryServerMessage =
  | { type: "welcome"; playerId: string; sessionToken: string; gameType: "pictionary" }
  | { type: "error"; message: string }
  | { type: "game-state"; state: PublicPictionaryState; currentWord?: string }
  | { type: "player-joined"; player: PublicPictionaryPlayer }
  | { type: "player-left"; playerId: string }
  | { type: "draw"; stroke: DrawStroke }
  | { type: "clear-canvas" }
  | { type: "guess"; playerId: string; name: string; guess: string; correct: boolean }
  | { type: "round-end"; word: string; winnerId: string | null }
  | { type: "game-end"; winner: PublicPictionaryPlayer };

// ============================================
// CODENAMES TYPES
// ============================================

export type CodenamesCardType = "green" | "neutral" | "assassin";

export interface CodenamesCard {
  word: string;
  type: CodenamesCardType;  // What this card actually is
  revealed: boolean;
}

export interface CodenamesPlayer extends BasePlayer {
  // In duet, all players work together
}

export type PublicCodenamesPlayer = Omit<CodenamesPlayer, "sessionToken">;

export interface CodenamesState {
  phase: CodenamesPhase;
  players: CodenamesPlayer[];
  board: CodenamesCard[];        // 25 cards (5x5)
  currentClue: { word: string; count: number } | null;
  guessesRemaining: number;
  turnsRemaining: number;
  greenRemaining: number;        // How many green cards left to find
  isClueGiver: boolean;          // Current player giving clue or guessing
  clueGiverId: string | null;    // Which player can see the full board
}

export interface PublicCodenamesState {
  phase: CodenamesPhase;
  players: PublicCodenamesPlayer[];
  board: Array<{
    word: string;
    revealed: boolean;
    type?: CodenamesCardType;    // Only shown if revealed
  }>;
  currentClue: { word: string; count: number } | null;
  guessesRemaining: number;
  turnsRemaining: number;
  greenRemaining: number;
}

// Codenames messages
export type CodenamesClientMessage =
  | { type: "join"; name: string; gameType: "codenames"; sessionToken?: string }
  | { type: "start-game" }
  | { type: "give-clue"; word: string; count: number }
  | { type: "guess"; cardIndex: number }
  | { type: "end-turn" }
  | { type: "new-game" };

export type CodenamesServerMessage =
  | { type: "welcome"; playerId: string; sessionToken: string; gameType: "codenames" }
  | { type: "error"; message: string }
  | { type: "game-state"; state: PublicCodenamesState; fullBoard?: CodenamesCard[] }
  | { type: "player-joined"; player: PublicCodenamesPlayer }
  | { type: "player-left"; playerId: string }
  | { type: "clue-given"; word: string; count: number }
  | { type: "card-revealed"; cardIndex: number; cardType: CodenamesCardType }
  | { type: "game-over"; won: boolean };

// ============================================
// UNIFIED MESSAGE TYPES
// ============================================

export type UnifiedClientMessage =
  | { type: "join"; name: string; gameType?: GameType; sessionToken?: string }
  | { type: "start-game" }
  | { type: "action"; action: PlayerAction }  // Poker
  | { type: "new-hand" }                      // Poker
  | PictionaryClientMessage
  | CodenamesClientMessage;

export type UnifiedServerMessage =
  | { type: "welcome"; playerId: string; sessionToken: string; gameType: GameType }
  | { type: "room-info"; gameType: GameType; playerCount: number }
  | ServerMessage
  | PictionaryServerMessage
  | CodenamesServerMessage;
