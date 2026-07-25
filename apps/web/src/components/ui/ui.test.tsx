// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { Input } from "./input";
import { Textarea } from "./textarea";

describe("design system", () => {
  it("Button primary: navy, uppercase tracking, overlay orange per lo slide", () => {
    const { container } = render(<Button variant="primary">Mint</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-navy");
    expect(btn.className).toContain("tracking-[0.2em]");
    expect(container.querySelector("[data-slide]")?.className).toContain("bg-orange");
  });
  it("Input: box arrotondato con bordo soft, focus orange", () => {
    render(<Input placeholder="il tuo nome" />);
    const input = screen.getByPlaceholderText("il tuo nome");
    expect(input.className).toContain("rounded-xl");
    expect(input.className).toContain("border-navy/20");
    expect(input.className).toContain("focus-visible:border-orange");
  });
  it("Textarea: stessa famiglia visiva di Input (bordo, focus orange, placeholder italic)", () => {
    render(<Textarea placeholder="how did it feel?" />);
    const textarea = screen.getByPlaceholderText("how did it feel?");
    expect(textarea.className).toContain("rounded-xl");
    expect(textarea.className).toContain("border-navy/20");
    expect(textarea.className).toContain("focus-visible:border-orange");
    expect(textarea.className).toContain("placeholder:italic");
  });
});
