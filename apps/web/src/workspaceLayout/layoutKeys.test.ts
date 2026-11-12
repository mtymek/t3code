import { describe, expect, it } from "vite-plus/test";

import { neighborGroup } from "./layoutKeys";

// Chat on the left; on the right, diff above two terminals side by side.
const boxes = [
  { id: "chat", box: { left: 0, top: 0, right: 500, bottom: 800 } },
  { id: "diff", box: { left: 501, top: 0, right: 1200, bottom: 400 } },
  { id: "terminal-a", box: { left: 501, top: 401, right: 800, bottom: 800 } },
  { id: "terminal-b", box: { left: 801, top: 401, right: 1200, bottom: 800 } },
];

describe("neighborGroup", () => {
  it("moves across dividers in each direction", () => {
    expect(neighborGroup(boxes, "diff", "down")).toBe("terminal-b");
    expect(neighborGroup(boxes, "terminal-b", "up")).toBe("diff");
    expect(neighborGroup(boxes, "terminal-a", "right")).toBe("terminal-b");
    expect(neighborGroup(boxes, "terminal-b", "left")).toBe("terminal-a");
    expect(neighborGroup(boxes, "terminal-a", "left")).toBe("chat");
  });

  it("prefers the larger overlap among equally near groups", () => {
    expect(neighborGroup(boxes, "chat", "right")).toBe("diff");
  });

  it("returns null at the window edge", () => {
    expect(neighborGroup(boxes, "chat", "left")).toBeNull();
    expect(neighborGroup(boxes, "diff", "up")).toBeNull();
  });
});
