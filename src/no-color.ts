// must be imported before prompts: its color library (kleur 3) reads the environment once, at load time,
// and only understands NODE_DISABLE_COLORS, not the NO_COLOR convention (https://no-color.org)
if (process.env.NO_COLOR) {
  process.env.NODE_DISABLE_COLORS = "1";
}
