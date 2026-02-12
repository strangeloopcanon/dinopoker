// Dino Games - Multi-Game Client

// ============================================
// SHARED CONSTANTS
// ============================================

const DINO_RANKS = {
  14: "T. rex",
  13: "Spinosaurus",
  12: "Giganotosaurus",
  11: "Allosaurus",
  10: "Triceratops",
  9: "Stegosaurus",
  8: "Velociraptor",
  7: "Brachiosaurus",
  6: "Ankylosaurus",
  5: "Parasaurolophus",
  4: "Dilophosaurus",
  3: "Compsognathus",
  2: "Microraptor",
};

const SUIT_SYMBOLS = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

const PHASE_NAMES = {
  preflop: "Pre-Flop",
  flop: "The Flop",
  turn: "The Turn",
  river: "The River",
};

// ============================================
// STATE
// ============================================

let ws = null;
let playerId = null;
let sessionToken = localStorage.getItem("dinogames_session");
let roomCode = null;
let selectedGame = "poker";
let currentGameType = null;

// Poker state
let pokerState = null;
let myCards = [];
let legalActions = null;

// Pictionary state
let pictionaryState = null;
let isDrawer = false;
let currentColor = "#000000";
let isDrawing = false;
let lastX = 0;
let lastY = 0;

// Codenames state
let codenamesState = null;
let fullBoard = null;

// ============================================
// DOM ELEMENTS
// ============================================

const screens = {
  join: document.getElementById("join-screen"),
  lobby: document.getElementById("lobby-screen"),
  game: document.getElementById("game-screen"),
  showdown: document.getElementById("showdown-screen"),
  pictionary: document.getElementById("pictionary-screen"),
  codenames: document.getElementById("codenames-screen"),
};

const elements = {
  // Join screen
  playerName: document.getElementById("player-name"),
  roomCode: document.getElementById("room-code"),
  joinBtn: document.getElementById("join-btn"),
  connectionStatus: document.getElementById("connection-status"),
  gameSelector: document.getElementById("game-selector"),
  gameOptions: document.querySelectorAll(".game-option"),
  
  // Lobby
  roomCodeDisplay: document.getElementById("room-code-display"),
  gameTypeDisplay: document.getElementById("game-type-display"),
  lobbyPlayers: document.getElementById("lobby-players"),
  startGameBtn: document.getElementById("start-game-btn"),
  
  // Poker
  communityCards: document.getElementById("community-cards"),
  potAmount: document.getElementById("pot-amount"),
  phaseIndicator: document.getElementById("phase-indicator"),
  otherPlayers: document.getElementById("other-players"),
  yourCards: document.getElementById("your-cards"),
  yourName: document.getElementById("your-name"),
  yourChips: document.getElementById("your-chips"),
  actions: document.getElementById("actions"),
  gameStatus: document.getElementById("game-status"),
  showdownTitle: document.getElementById("showdown-title"),
  showdownResults: document.getElementById("showdown-results"),
  nextHandBtn: document.getElementById("next-hand-btn"),
  btnFold: document.getElementById("btn-fold"),
  btnCheck: document.getElementById("btn-check"),
  btnCall: document.getElementById("btn-call"),
  btnRaise: document.getElementById("btn-raise"),
  btnAllin: document.getElementById("btn-allin"),
  
  // Pictionary
  pictRound: document.getElementById("pict-round"),
  pictTotalRounds: document.getElementById("pict-total-rounds"),
  pictTimer: document.getElementById("pict-timer"),
  pictWordDisplay: document.getElementById("pict-word-display"),
  pictCurrentWord: document.getElementById("pict-current-word"),
  pictWordHint: document.getElementById("pict-word-hint"),
  pictWordBlanks: document.getElementById("pict-word-blanks"),
  pictWordPicker: document.getElementById("pict-word-picker"),
  pictWordChoices: document.getElementById("pict-word-choices"),
  pictCanvas: document.getElementById("pict-canvas"),
  pictDrawTools: document.getElementById("pict-draw-tools"),
  pictClearBtn: document.getElementById("pict-clear-btn"),
  pictGuessArea: document.getElementById("pict-guess-area"),
  pictGuesses: document.getElementById("pict-guesses"),
  pictGuessInput: document.getElementById("pict-guess-input"),
  pictGuessBtn: document.getElementById("pict-guess-btn"),
  pictScoreboard: document.getElementById("pict-scoreboard"),
  pictRoundEnd: document.getElementById("pict-round-end"),
  pictRevealedWord: document.getElementById("pict-revealed-word"),
  pictNextRoundBtn: document.getElementById("pict-next-round-btn"),
  
  // Codenames
  cnTurns: document.getElementById("cn-turns"),
  cnGreen: document.getElementById("cn-green"),
  cnClueDisplay: document.getElementById("cn-clue-display"),
  cnClueWord: document.getElementById("cn-clue-word"),
  cnClueCount: document.getElementById("cn-clue-count"),
  cnGuessesLeft: document.getElementById("cn-guesses-left"),
  cnBoard: document.getElementById("cn-board"),
  cnClueControls: document.getElementById("cn-clue-controls"),
  cnClueInput: document.getElementById("cn-clue-input"),
  cnClueNumber: document.getElementById("cn-clue-number"),
  cnGiveClueBtn: document.getElementById("cn-give-clue-btn"),
  cnGuessControls: document.getElementById("cn-guess-controls"),
  cnEndTurnBtn: document.getElementById("cn-end-turn-btn"),
  cnGameOver: document.getElementById("cn-game-over"),
  cnGameResult: document.getElementById("cn-game-result"),
  cnNewGameBtn: document.getElementById("cn-new-game-btn"),
  cnPlayers: document.getElementById("cn-players"),
};

// ============================================
// UTILITIES
// ============================================

function showScreen(screenName) {
  Object.values(screens).forEach(s => s.classList.remove("active"));
  screens[screenName]?.classList.add("active");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ============================================
// GAME SELECTION
// ============================================

function updateGameSelector() {
  const hasRoomCode = elements.roomCode.value.trim().length > 0;
  elements.gameSelector.style.display = hasRoomCode ? "none" : "block";
}

elements.roomCode.addEventListener("input", updateGameSelector);

elements.gameOptions.forEach(btn => {
  btn.addEventListener("click", () => {
    elements.gameOptions.forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedGame = btn.dataset.game;
  });
});

// ============================================
// WEBSOCKET CONNECTION
// ============================================

function connect(room) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  
  ws = new WebSocket(`${protocol}//${host}/party/${room}`);
  
  ws.onopen = () => {
    console.log("Connected to room:", room);
    elements.connectionStatus.textContent = "Connected!";
    roomCode = room;
    
    const name = elements.playerName.value.trim() || "Dino";
    const isCreating = elements.roomCode.value.trim().length === 0;
    
    ws.send(JSON.stringify({
      type: "join",
      name,
      gameType: isCreating ? selectedGame : undefined,
      sessionToken,
    }));
  };
  
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };
  
  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    elements.connectionStatus.textContent = "Connection error!";
  };
  
  ws.onclose = () => {
    console.log("Disconnected");
    elements.connectionStatus.textContent = "Disconnected. Refresh to reconnect.";
  };
}

// ============================================
// MESSAGE HANDLER
// ============================================

function handleMessage(msg) {
  console.log("Received:", msg.type, msg);
  
  switch (msg.type) {
    case "welcome":
      playerId = msg.playerId;
      sessionToken = msg.sessionToken;
      currentGameType = msg.gameType;
      localStorage.setItem("dinogames_session", sessionToken);
      elements.roomCodeDisplay.textContent = roomCode.toUpperCase();
      updateLobbyGameType(msg.gameType);
      showScreen("lobby");
      break;
      
    case "room-info":
      currentGameType = msg.gameType;
      updateLobbyGameType(msg.gameType);
      break;
      
    case "error":
      elements.connectionStatus.textContent = msg.message;
      alert(msg.message);
      break;
      
    case "player-joined":
    case "player-left":
      // Will be followed by game-state
      break;
      
    case "game-state":
      handleGameState(msg);
      break;
      
    case "action-taken":
      // Poker action feedback
      break;
      
    case "showdown":
      showScreen("showdown");
      renderShowdown(msg.results);
      break;
      
    case "hand-complete":
      elements.showdownTitle.textContent = 
        `${msg.winnerName} wins with ${msg.dinoHandName}`;
      break;
      
    // Pictionary messages
    case "draw":
      drawStrokeOnCanvas(msg.stroke);
      break;
      
    case "clear-canvas":
      clearCanvas();
      break;
      
    case "guess":
      addGuessToList(msg);
      break;
      
    case "round-end":
      showPictionaryRoundEnd(msg.word);
      break;
      
    // Codenames messages
    case "clue-given":
      showClue(msg.word, msg.count);
      break;
      
    case "card-revealed":
      revealCard(msg.cardIndex, msg.cardType);
      break;
      
    case "game-over":
      showCodenamesGameOver(msg.won);
      break;
  }
}

function handleGameState(msg) {
  const gameType = msg.gameType || currentGameType;
  
  if (!gameType || msg.state.phase === "lobby") {
    showScreen("lobby");
    renderLobbyPlayers(msg.state.players);
    return;
  }
  
  switch (gameType) {
    case "poker":
      handlePokerState(msg);
      break;
    case "pictionary":
      handlePictionaryState(msg);
      break;
    case "codenames":
      handleCodenamesState(msg);
      break;
  }
}

// ============================================
// LOBBY
// ============================================

function updateLobbyGameType(gameType) {
  const names = {
    poker: "🃏 Cretaceous Hold'em",
    pictionary: "🎨 Paleo Pictionary",
    codenames: "🔍 Cretaceous Codenames",
  };
  elements.gameTypeDisplay.textContent = names[gameType] || gameType;
}

function renderLobbyPlayers(players) {
  elements.lobbyPlayers.innerHTML = "";
  
  players.forEach((player, idx) => {
    const div = document.createElement("div");
    div.className = "lobby-player";
    const safeName = escapeHtml(player.name);
    div.innerHTML = `
      <span class="player-number">${idx + 1}</span>
      <span class="player-name">${safeName}</span>
      ${player.isDealer ? '<span class="dealer-tag">Host</span>' : ""}
    `;
    elements.lobbyPlayers.appendChild(div);
  });
  
  const minPlayers = currentGameType === "codenames" ? 2 : 2;
  const canStart = players.length >= minPlayers;
  elements.startGameBtn.disabled = !canStart;
  elements.startGameBtn.textContent = canStart 
    ? "Start Game" 
    : `Need ${minPlayers - players.length} more player(s)`;
}

// ============================================
// POKER
// ============================================

function handlePokerState(msg) {
  if (msg.state.phase === "showdown") {
    showScreen("showdown");
    elements.showdownTitle.textContent = "Hand complete";
    if (elements.showdownResults.childElementCount === 0) {
      renderShowdownFromState(msg.state);
    }
    return;
  }
  
  showScreen("game");
  updatePokerUI(msg.state, msg.yourCards, msg.legalActions);
}

function renderCard(card, faceDown = false) {
  const div = document.createElement("div");
  div.className = `card ${card.suit}`;
  
  if (faceDown) {
    div.classList.add("face-down");
    div.innerHTML = `<span class="card-back">🦖</span>`;
  } else {
    const dinoName = DINO_RANKS[card.rank] || card.rank;
    const suitSymbol = SUIT_SYMBOLS[card.suit];
    div.innerHTML = `
      <span class="card-rank">${dinoName}</span>
      <span class="card-suit">${suitSymbol}</span>
    `;
  }
  
  return div;
}

function renderCards(container, cards, faceDown = false) {
  container.innerHTML = "";
  cards.forEach(card => {
    container.appendChild(renderCard(card, faceDown));
  });
}

function renderOtherPlayers(players) {
  elements.otherPlayers.innerHTML = "";
  
  players.forEach(player => {
    if (player.id === playerId) return;
    
    const div = document.createElement("div");
    div.className = `other-player ${player.folded ? "folded" : ""} ${player.id === pokerState?.players[pokerState?.activePlayerIndex]?.id ? "active" : ""}`;
    
    const safeName = escapeHtml(player.name);
    const dealerBadge = player.isDealer ? ' <span class="dealer-badge">(D)</span>' : "";
    const statusText = player.folded ? "Folded" : player.allIn ? "All In" : "";
    
    div.innerHTML = `
      <div class="player-info">
        <span class="player-name">${safeName}${dealerBadge}</span>
        <span class="player-chips">${player.chips}</span>
        ${statusText ? `<span class="player-status">${statusText}</span>` : ""}
        ${player.currentBet > 0 ? `<span class="player-bet">Bet ${player.currentBet}</span>` : ""}
      </div>
      <div class="player-cards">
        ${player.hasCards && !player.folded ? '<div class="card face-down small"><span class="card-back"></span></div><div class="card face-down small"><span class="card-back"></span></div>' : ""}
      </div>
    `;
    
    elements.otherPlayers.appendChild(div);
  });
}

function updatePokerUI(state, yourCards, legal) {
  pokerState = state;
  myCards = yourCards || [];
  legalActions = legal;
  
  const me = state.players.find(p => p.id === playerId);
  const totalPot = state.pots.reduce((sum, pot) => sum + pot.amount, 0);
  
  elements.potAmount.textContent = totalPot;
  elements.phaseIndicator.textContent = PHASE_NAMES[state.phase] || "";
  
  renderCards(elements.communityCards, state.communityCards);
  renderOtherPlayers(state.players);
  
  if (myCards.length > 0) {
    renderCards(elements.yourCards, myCards);
  } else {
    elements.yourCards.innerHTML = "";
  }
  
  if (me) {
    elements.yourName.textContent = me.name + (me.isDealer ? " (D)" : "");
    elements.yourChips.textContent = me.chips;
  }
  
  updateActions(legal);
  
  const activePlayer = state.players[state.activePlayerIndex];
  if (activePlayer) {
    const isYourTurn = activePlayer.id === playerId;
    elements.gameStatus.textContent = isYourTurn 
      ? "Your turn!" 
      : `${activePlayer.name}'s turn...`;
    elements.gameStatus.className = isYourTurn ? "your-turn" : "";
  }
}

function updateActions(legal) {
  if (!legal) {
    elements.actions.classList.add("hidden");
    return;
  }
  
  elements.actions.classList.remove("hidden");
  
  elements.btnFold.style.display = legal.canFold ? "" : "none";
  elements.btnCheck.style.display = legal.canCheck ? "" : "none";
  elements.btnCall.style.display = legal.canCall ? "" : "none";
  elements.btnRaise.style.display = legal.canRaise ? "" : "none";
  elements.btnAllin.style.display = legal.canAllIn ? "" : "none";
  
  if (legal.canCall) {
    elements.btnCall.textContent = `Call ${legal.callAmount}`;
  }
  if (legal.canRaise) {
    elements.btnRaise.textContent = `Raise ${legal.minRaise}`;
  }
  if (legal.canAllIn) {
    elements.btnAllin.textContent = `All In ${legal.allInAmount}`;
  }
}

function renderShowdown(results) {
  elements.showdownResults.innerHTML = "";
  
  results.forEach(result => {
    const div = document.createElement("div");
    div.className = `showdown-player ${result.isWinner ? "winner" : ""}`;
    const safeName = escapeHtml(result.name);
    
    const cardsHtml = result.holeCards
      .map(card => {
        const dinoName = DINO_RANKS[card.rank];
        const suitSymbol = SUIT_SYMBOLS[card.suit];
        return `<span class="mini-card ${card.suit}">${dinoName} ${suitSymbol}</span>`;
      })
      .join(" ");
    
    div.innerHTML = `
      <div class="showdown-player-name">${safeName}</div>
      <div class="showdown-cards">${cardsHtml}</div>
      <div class="showdown-hand">${result.dinoHandName}</div>
      ${result.isWinner ? `<div class="showdown-pot">+${result.potWon} Amber!</div>` : ""}
    `;
    
    elements.showdownResults.appendChild(div);
  });
}

function renderShowdownFromState(state) {
  elements.showdownResults.innerHTML = "";

  state.players.forEach(player => {
    const div = document.createElement("div");
    div.className = "showdown-player";
    const safeName = escapeHtml(player.name);
    const status = player.folded ? "Folded" : player.allIn ? "All In" : "Still in hand";

    div.innerHTML = `
      <div class="showdown-player-name">${safeName}</div>
      <div class="showdown-hand">${status}</div>
      <div class="showdown-pot">${player.chips} chips</div>
    `;

    elements.showdownResults.appendChild(div);
  });
}

function sendPokerAction(type, amount) {
  if (!ws) return;
  ws.send(JSON.stringify({
    type: "action",
    action: { type, amount },
  }));
}

// ============================================
// PICTIONARY
// ============================================

function handlePictionaryState(msg) {
  pictionaryState = msg.state;
  isDrawer = msg.state.currentDrawerId === playerId;
  
  showScreen("pictionary");
  
  // Update round info
  elements.pictRound.textContent = msg.state.roundNumber;
  elements.pictTotalRounds.textContent = msg.state.totalRounds;
  elements.pictTimer.textContent = msg.state.roundTimeLeft;
  
  // Update scoreboard
  renderPictionaryScoreboard(msg.state.players);
  
  // Handle different phases
  switch (msg.state.phase) {
    case "picking":
      showWordPicker(msg.state.wordChoices);
      break;
    case "drawing":
      showDrawingPhase(msg.currentWord, msg.state.wordLength);
      break;
    case "reveal":
    case "ended":
      // Handled by round-end message
      break;
  }
}

function showWordPicker(choices) {
  elements.pictWordPicker.classList.remove("hidden");
  elements.pictWordDisplay.classList.add("hidden");
  elements.pictWordHint.classList.add("hidden");
  elements.pictDrawTools.classList.add("hidden");
  elements.pictGuessArea.classList.add("hidden");
  elements.pictRoundEnd.classList.add("hidden");
  
  if (isDrawer && choices) {
    elements.pictWordChoices.innerHTML = "";
    choices.forEach(word => {
      const btn = document.createElement("button");
      btn.className = "btn secondary";
      btn.textContent = word;
      btn.onclick = () => {
        ws.send(JSON.stringify({ type: "pick-word", word }));
      };
      elements.pictWordChoices.appendChild(btn);
    });
  } else {
    elements.pictWordChoices.innerHTML = "<p>Waiting for drawer to pick a word...</p>";
  }
}

function showDrawingPhase(currentWord, wordLength) {
  elements.pictWordPicker.classList.add("hidden");
  elements.pictRoundEnd.classList.add("hidden");
  
  if (isDrawer) {
    elements.pictWordDisplay.classList.remove("hidden");
    elements.pictCurrentWord.textContent = currentWord;
    elements.pictDrawTools.classList.remove("hidden");
    elements.pictGuessArea.classList.add("hidden");
    elements.pictWordHint.classList.add("hidden");
  } else {
    elements.pictWordDisplay.classList.add("hidden");
    elements.pictWordHint.classList.remove("hidden");
    elements.pictWordBlanks.textContent = "_".repeat(wordLength);
    elements.pictDrawTools.classList.add("hidden");
    elements.pictGuessArea.classList.remove("hidden");
  }
}

function showPictionaryRoundEnd(word) {
  elements.pictWordPicker.classList.add("hidden");
  elements.pictWordDisplay.classList.add("hidden");
  elements.pictWordHint.classList.add("hidden");
  elements.pictDrawTools.classList.add("hidden");
  elements.pictGuessArea.classList.add("hidden");
  elements.pictRoundEnd.classList.remove("hidden");
  elements.pictRevealedWord.textContent = word;
}

function renderPictionaryScoreboard(players) {
  elements.pictScoreboard.innerHTML = "";
  
  const sorted = [...players].sort((a, b) => b.score - a.score);
  sorted.forEach(player => {
    const div = document.createElement("div");
    div.className = `scoreboard-player ${player.id === pictionaryState?.currentDrawerId ? "drawing" : ""}`;
    div.innerHTML = `
      <span class="player-name">${escapeHtml(player.name)}</span>
      <span class="player-score">${player.score}</span>
    `;
    elements.pictScoreboard.appendChild(div);
  });
}

function addGuessToList(msg) {
  const div = document.createElement("div");
  div.className = `guess ${msg.correct ? "correct" : ""}`;
  div.innerHTML = `<strong>${escapeHtml(msg.name)}:</strong> ${escapeHtml(msg.guess)}`;
  elements.pictGuesses.appendChild(div);
  elements.pictGuesses.scrollTop = elements.pictGuesses.scrollHeight;
}

// Canvas Drawing
function setupCanvas() {
  const canvas = elements.pictCanvas;
  if (!canvas) return;
  
  const ctx = canvas.getContext("2d");
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }
  
  let currentStroke = null;
  
  function startDraw(e) {
    if (!isDrawer) return;
    e.preventDefault();
    isDrawing = true;
    const pos = getPos(e);
    lastX = pos.x;
    lastY = pos.y;
    currentStroke = {
      points: [{ x: pos.x, y: pos.y }],
      color: currentColor,
      width: 3,
    };
  }
  
  function draw(e) {
    if (!isDrawing || !isDrawer) return;
    e.preventDefault();
    
    const pos = getPos(e);
    
    ctx.strokeStyle = currentColor;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    
    currentStroke.points.push({ x: pos.x, y: pos.y });
    lastX = pos.x;
    lastY = pos.y;
  }
  
  function endDraw(e) {
    if (!isDrawing || !currentStroke) return;
    isDrawing = false;
    
    // Send stroke to server
    ws.send(JSON.stringify({ type: "draw", stroke: currentStroke }));
    currentStroke = null;
  }
  
  canvas.addEventListener("mousedown", startDraw);
  canvas.addEventListener("mousemove", draw);
  canvas.addEventListener("mouseup", endDraw);
  canvas.addEventListener("mouseleave", endDraw);
  
  canvas.addEventListener("touchstart", startDraw);
  canvas.addEventListener("touchmove", draw);
  canvas.addEventListener("touchend", endDraw);
}

function drawStrokeOnCanvas(stroke) {
  const canvas = elements.pictCanvas;
  if (!canvas) return;
  
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  
  if (stroke.points.length < 2) return;
  
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
  
  for (let i = 1; i < stroke.points.length; i++) {
    ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
  }
  
  ctx.stroke();
}

function clearCanvas() {
  const canvas = elements.pictCanvas;
  if (!canvas) return;
  
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fffef5";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// ============================================
// CODENAMES
// ============================================

function handleCodenamesState(msg) {
  codenamesState = msg.state;
  fullBoard = msg.fullBoard;
  
  showScreen("codenames");
  
  elements.cnTurns.textContent = msg.state.turnsRemaining;
  elements.cnGreen.textContent = msg.state.greenRemaining;
  
  renderCodenamesBoard(msg.state.board, fullBoard);
  renderCodenamesPlayers(msg.state.players);
  
  // Handle game over
  if (msg.state.phase === "won" || msg.state.phase === "lost") {
    showCodenamesGameOver(msg.state.phase === "won");
    return;
  }
  
  elements.cnGameOver.classList.add("hidden");
  
  // Show/hide controls based on isClueGiver
  // In Duet, we alternate between giving clues and guessing
  const isClueGiver = fullBoard != null; // If we have full board, we're the clue giver
  
  if (msg.state.currentClue) {
    elements.cnClueDisplay.classList.remove("hidden");
    elements.cnClueWord.textContent = msg.state.currentClue.word;
    elements.cnClueCount.textContent = msg.state.currentClue.count;
    elements.cnGuessesLeft.textContent = msg.state.guessesRemaining;
    elements.cnClueControls.classList.add("hidden");
    elements.cnGuessControls.classList.remove("hidden");
  } else {
    elements.cnClueDisplay.classList.add("hidden");
    if (isClueGiver) {
      elements.cnClueControls.classList.remove("hidden");
      elements.cnGuessControls.classList.add("hidden");
    } else {
      elements.cnClueControls.classList.add("hidden");
      elements.cnGuessControls.classList.add("hidden");
    }
  }
}

function renderCodenamesBoard(board, full) {
  elements.cnBoard.innerHTML = "";
  
  board.forEach((card, index) => {
    const div = document.createElement("div");
    div.className = "cn-card";
    
    if (card.revealed) {
      div.classList.add("revealed", card.type);
    } else if (full) {
      // Show color hint for clue giver
      div.classList.add("hint-" + full[index].type);
    }
    
    div.textContent = card.word;
    
    if (!card.revealed && !full) {
      div.onclick = () => {
        ws.send(JSON.stringify({ type: "guess", cardIndex: index }));
      };
    }
    
    elements.cnBoard.appendChild(div);
  });
}

function renderCodenamesPlayers(players) {
  elements.cnPlayers.innerHTML = "";
  
  players.forEach(player => {
    const div = document.createElement("div");
    div.className = "cn-player";
    div.innerHTML = `<span>${escapeHtml(player.name)}</span>`;
    elements.cnPlayers.appendChild(div);
  });
}

function showClue(word, count) {
  elements.cnClueDisplay.classList.remove("hidden");
  elements.cnClueWord.textContent = word;
  elements.cnClueCount.textContent = count;
}

function revealCard(cardIndex, type) {
  const cards = elements.cnBoard.querySelectorAll(".cn-card");
  if (cards[cardIndex]) {
    cards[cardIndex].classList.add("revealed", type);
  }
}

function showCodenamesGameOver(won) {
  elements.cnGameOver.classList.remove("hidden");
  elements.cnClueControls.classList.add("hidden");
  elements.cnGuessControls.classList.add("hidden");
  elements.cnGameResult.textContent = won ? "Victory! All agents found!" : "Game Over";
}

// ============================================
// EVENT LISTENERS
// ============================================

// Join
elements.joinBtn.addEventListener("click", () => {
  const room = elements.roomCode.value.trim().toUpperCase() || generateRoomCode();
  elements.connectionStatus.textContent = "Connecting...";
  connect(room);
});

elements.playerName.addEventListener("keypress", (e) => {
  if (e.key === "Enter") elements.joinBtn.click();
});

elements.roomCode.addEventListener("keypress", (e) => {
  if (e.key === "Enter") elements.joinBtn.click();
});

// Lobby
elements.startGameBtn.addEventListener("click", () => {
  if (!ws) return;
  ws.send(JSON.stringify({ type: "start-game" }));
});

// Poker
elements.nextHandBtn.addEventListener("click", () => {
  if (!ws) return;
  ws.send(JSON.stringify({ type: "new-hand" }));
});

elements.btnFold.addEventListener("click", () => sendPokerAction("fold"));
elements.btnCheck.addEventListener("click", () => sendPokerAction("check"));
elements.btnCall.addEventListener("click", () => sendPokerAction("call"));
elements.btnRaise.addEventListener("click", () => sendPokerAction("raise", legalActions?.minRaise));
elements.btnAllin.addEventListener("click", () => sendPokerAction("all-in"));

// Pictionary
document.querySelectorAll(".color-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    currentColor = btn.dataset.color;
    document.querySelectorAll(".color-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

elements.pictClearBtn?.addEventListener("click", () => {
  clearCanvas();
  ws?.send(JSON.stringify({ type: "clear-canvas" }));
});

elements.pictGuessBtn?.addEventListener("click", () => {
  const guess = elements.pictGuessInput.value.trim();
  if (guess) {
    ws?.send(JSON.stringify({ type: "guess", text: guess }));
    elements.pictGuessInput.value = "";
  }
});

elements.pictGuessInput?.addEventListener("keypress", (e) => {
  if (e.key === "Enter") elements.pictGuessBtn?.click();
});

elements.pictNextRoundBtn?.addEventListener("click", () => {
  ws?.send(JSON.stringify({ type: "next-round" }));
});

// Codenames
elements.cnGiveClueBtn?.addEventListener("click", () => {
  const word = elements.cnClueInput.value.trim();
  const count = parseInt(elements.cnClueNumber.value) || 1;
  if (word) {
    ws?.send(JSON.stringify({ type: "give-clue", word, count }));
    elements.cnClueInput.value = "";
  }
});

elements.cnEndTurnBtn?.addEventListener("click", () => {
  ws?.send(JSON.stringify({ type: "end-turn" }));
});

elements.cnNewGameBtn?.addEventListener("click", () => {
  ws?.send(JSON.stringify({ type: "new-game" }));
});

// ============================================
// INITIALIZATION
// ============================================

setupCanvas();
updateGameSelector();
console.log("Dino Games loaded!");
