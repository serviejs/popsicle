import { fetch, middleware } from "./index";

describe("popsicle", () => {
  it("should export a fetch and middleware function", () => {
    expect(fetch).toBeInstanceOf(Function);
    expect(middleware).toBeInstanceOf(Function);
  });
});
