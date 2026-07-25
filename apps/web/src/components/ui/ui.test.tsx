// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { Input } from "./input";

describe("design system", () => {
  it("Button primary: navy, uppercase tracking, overlay orange per lo slide", () => {
    const { container } = render(<Button variant="primary">Mint</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-navy");
    expect(btn.className).toContain("tracking-[0.2em]");
    expect(container.querySelector("[data-slide]")?.className).toContain("bg-orange");
  });
  it("Input: solo border-b, focus orange", () => {
    render(<Input placeholder="il tuo nome" />);
    const input = screen.getByPlaceholderText("il tuo nome");
    expect(input.className).toContain("border-b");
    expect(input.className).not.toContain("border-t");
    expect(input.className).toContain("focus-visible:border-orange");
  });
});
