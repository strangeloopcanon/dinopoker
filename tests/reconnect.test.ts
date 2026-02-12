import { describe, it, expect } from "vitest";
import { PictionaryGameHandler } from "../party/games/pictionary.js";
import { CodenamesGameHandler } from "../party/games/codenames.js";

describe("Reconnect ID remapping", () => {
  it("keeps pictionary drawer and guesses aligned after reconnect", () => {
    const handler = new PictionaryGameHandler();
    handler.addPlayer("old-id", "Alice", "token-a");
    handler.addPlayer("bob-id", "Bob", "token-b");

    const mutableState = (handler as unknown as { state: any }).state;
    mutableState.currentDrawerId = "old-id";
    mutableState.guesses = [
      { playerId: "old-id", name: "Alice", guess: "tree", correct: false },
    ];

    handler.updatePlayerId("token-a", "new-id");

    expect(handler.getPlayerByToken("token-a")?.id).toBe("new-id");
    expect(mutableState.currentDrawerId).toBe("new-id");
    expect(mutableState.guesses[0].playerId).toBe("new-id");
  });

  it("keeps codenames clue giver aligned after reconnect", () => {
    const handler = new CodenamesGameHandler();
    handler.addPlayer("old-id", "Alice", "token-a");
    handler.addPlayer("bob-id", "Bob", "token-b");

    const mutableState = (handler as unknown as { state: any }).state;
    mutableState.clueGiverId = "old-id";

    handler.updatePlayerId("token-a", "new-id");

    expect(handler.getPlayerByToken("token-a")?.id).toBe("new-id");
    expect(mutableState.clueGiverId).toBe("new-id");
  });
});
