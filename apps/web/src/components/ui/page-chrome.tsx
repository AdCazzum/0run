const NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

export function PageChrome() {
  return (
    <>
      {/* Paper grain sits ABOVE the page on purpose: it is a texture over everything,
          at 2% opacity and never interactive. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-50 opacity-[0.02]" style={{ backgroundImage: NOISE }} />
      {/* The gridlines are structure, not decoration on top: they must sit BEHIND the
          content. A fixed element with z-0 paints above non-positioned in-flow content
          (positioned boxes with z-index 0 are painted in a later layer than normal
          flow), which is why the lines used to cross the text — hence the negative
          index, which keeps them above the page background but under everything else. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 mx-auto hidden max-w-[1600px] lg:block">
        {["8%", "36%", "64%", "92%"].map((left) => (
          <div key={left} className="absolute top-0 h-full w-px bg-navy/20" style={{ left }} />
        ))}
      </div>
    </>
  );
}
