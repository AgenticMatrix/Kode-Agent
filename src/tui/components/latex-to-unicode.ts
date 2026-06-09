/**
 * LaTeX → Unicode math renderer for terminal display.
 *
 * Converts LaTeX math expressions into Unicode equivalents,
 * similar to how KaTeX renders math in the browser — but for the terminal.
 *
 * Handles:
 * - Greek letters (lowercase + uppercase)
 * - Math symbols (∞, ∑, ∫, √, ∂, ∇, …)
 * - Binary operators (×, ·, ±, ÷, ⊕, ⊗, …)
 * - Relations (≤, ≥, ≠, ≈, ≡, …)
 * - Arrows (→, ←, ⇒, ⇐, ↔, …)
 * - Superscripts (x², e^{iπ}, …)
 * - Subscripts (x₁, a_{ij}, …)
 * - Fractions (\frac{a}{b} → Unicode sup/sub fraction)
 * - Roots (\sqrt{x}, \sqrt[n]{x})
 * - Accents (\hat{x} → x̂, \bar{x} → x̄, \vec{x} → x⃗)
 * - Text commands (\text{...}, \mathrm{...})
 */

// ─── Unicode maps ──────────────────────────────────────────────────────────

/** Digit → superscript Unicode */
const SUPER_DIGITS: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};

/** Digit → subscript Unicode */
const SUB_DIGITS: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
};

/** Lowercase letter → superscript (limited Unicode support) */
const SUPER_LOWER: Record<string, string> = {
  a: 'ᵃ',
  b: 'ᵇ',
  c: 'ᶜ',
  d: 'ᵈ',
  e: 'ᵉ',
  f: 'ᶠ',
  g: 'ᵍ',
  h: 'ʰ',
  i: 'ⁱ',
  j: 'ʲ',
  k: 'ᵏ',
  l: 'ˡ',
  m: 'ᵐ',
  n: 'ⁿ',
  o: 'ᵒ',
  p: 'ᵖ',
  r: 'ʳ',
  s: 'ˢ',
  t: 'ᵗ',
  u: 'ᵘ',
  v: 'ᵛ',
  w: 'ʷ',
  x: 'ˣ',
  y: 'ʸ',
  z: 'ᶻ',
};

/** Lowercase letter → subscript */
const SUB_LOWER: Record<string, string> = {
  a: 'ₐ',
  e: 'ₑ',
  h: 'ₕ',
  i: 'ᵢ',
  j: 'ⱼ',
  k: 'ₖ',
  l: 'ₗ',
  m: 'ₘ',
  n: 'ₙ',
  o: 'ₒ',
  p: 'ₚ',
  r: 'ᵣ',
  s: 'ₛ',
  t: 'ₜ',
  u: 'ᵤ',
  v: 'ᵥ',
  x: 'ₓ',
};

/** Greek lowercase LaTeX → Unicode */
const GREEK_LOWER: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'ϑ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  varpi: 'ϖ',
  rho: 'ρ',
  varrho: 'ϱ',
  sigma: 'σ',
  varsigma: 'ς',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'ϕ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
};

/** Greek uppercase LaTeX → Unicode */
const GREEK_UPPER: Record<string, string> = {
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
};

/** Command aliases */
const COMMAND_ALIASES: Record<string, string> = {
  to: 'rightarrow',
  gets: 'leftarrow',
  Rightarrow: 'Rightarrow',
  Leftarrow: 'Leftarrow',
  ne: 'neq',
  le: 'leq',
  ge: 'geq',
};

/** Operators that render as plain text */
const OPERATOR_NAMES = new Set([
  'lim', 'max', 'min', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh',
  'log', 'ln', 'lg',
  'det', 'gcd', 'deg',
  'sup', 'inf', 'arg',
  'exp', 'ker', 'dim', 'hom',
  'Pr', 'mod',
]);

/** Math symbols LaTeX → Unicode */
const MATH_SYMBOLS: Record<string, string> = {
  // Operators
  times: '×',
  cdot: '·',
  pm: '±',
  mp: '∓',
  div: '÷',
  ast: '∗',
  star: '⋆',
  circ: '∘',
  bullet: '•',
  oplus: '⊕',
  ominus: '⊖',
  otimes: '⊗',
  oslash: '⊘',
  odot: '⊙',
  wedge: '∧',
  vee: '∨',
  cap: '∩',
  cup: '∪',
  setminus: '∖',
  sqcap: '⊓',
  sqcup: '⊔',
  // Relations
  leq: '≤',
  geq: '≥',
  neq: '≠',
  equiv: '≡',
  approx: '≈',
  sim: '∼',
  simeq: '≃',
  propto: '∝',
  ll: '≪',
  gg: '≫',
  prec: '≺',
  succ: '≻',
  preceq: '≼',
  succeq: '≽',
  subset: '⊂',
  supset: '⊃',
  subseteq: '⊆',
  supseteq: '⊇',
  sqsubset: '⊏',
  sqsupset: '⊐',
  sqsubseteq: '⊑',
  sqsupseteq: '⊒',
  in: '∈',
  ni: '∋',
  notin: '∉',
  perp: '⊥',
  parallel: '∥',
  // Arrows
  rightarrow: '→',
  leftarrow: '←',
  uparrow: '↑',
  downarrow: '↓',
  Rightarrow: '⇒',
  Leftarrow: '⇐',
  Uparrow: '⇑',
  Downarrow: '⇓',
  leftrightarrow: '↔',
  Leftrightarrow: '⇔',
  mapsto: '↦',
  longrightarrow: '⟶',
  longleftarrow: '⟵',
  Longrightarrow: '⟹',
  Longleftarrow: '⟸',
  longleftrightarrow: '⟷',
  Longleftrightarrow: '⟺',
  rightleftharpoons: '⇌',
  // Big operators
  sum: '∑',
  prod: '∏',
  coprod: '∐',
  int: '∫',
  iint: '∬',
  iiint: '∭',
  oint: '∮',
  bigcup: '⋃',
  bigcap: '⋂',
  bigvee: '⋁',
  bigwedge: '⋀',
  bigoplus: '⨁',
  bigotimes: '⨂',
  bigodot: '⨀',
  bigsqcup: '⨆',
  // Special
  infty: '∞',
  partial: '∂',
  nabla: '∇',
  emptyset: '∅',
  varnothing: '∅',
  exists: '∃',
  forall: '∀',
  neg: '¬',
  lnot: '¬',
  top: '⊤',
  bot: '⊥',
  angle: '∠',
  triangle: '△',
  square: '□',
  diamond: '⋄',
  cdotp: '·',
  colon: ':',
  dots: '…',
  ldots: '…',
  cdots: '⋯',
  vdots: '⋮',
  ddots: '⋱',
  therefore: '∴',
  because: '∵',
  hbar: 'ℏ',
  ell: 'ℓ',
  wp: '℘',
  Re: 'ℜ',
  Im: 'ℑ',
  aleph: 'ℵ',
  // Delimiters
  langle: '⟨',
  rangle: '⟩',
  lceil: '⌈',
  rceil: '⌉',
  lfloor: '⌊',
  rfloor: '⌋',
  // Misc
  mid: '∣',
  nmid: '∤',
  backslash: '\\',
};

/** Combining diacritical marks for accents */
const ACCENTS: Record<string, string> = {
  hat: '̂',   // ◌̂ combining circumflex
  bar: '̄',   // ◌̄ combining macron
  vec: '⃗',   // ◌⃗ combining right arrow above
  dot: '̇',   // ◌̇ combining dot above
  ddot: '̈',  // ◌̈ combining diaeresis
  tilde: '̃', // ◌̃ combining tilde
  check: '̌', // ◌̌ combining caron
  breve: '̆', // ◌̆ combining breve
  acute: '́', // ◌́ combining acute
  grave: '̀', // ◌̀ combining grave
};

// ─── Parser state ──────────────────────────────────────────────────────────

/**
 * Recursive LaTeX-to-Unicode converter.
 *
 * Strategy:
 * 1. Scan character by character
 * 2. Backslash → read command name → lookup symbol
 * 3. `^`  → convert following group to superscript
 * 4. `_`  → convert following group to subscript
 * 5. `{` `}` → extract group content
 * 6. `\frac{a}{b}` → render as inline fraction
 * 7. `\sqrt[n]{x}` → render as radical
 * 8. `\text{...}` → pass through as plain text
 * 9. Other characters → pass through
 */

interface ParseResult {
  text: string;
  pos: number;
}

export function renderLatex(latex: string): string {
  return parse(latex, 0, latex.length).text;
}

function parse(input: string, start: number, end: number): ParseResult {
  let result = '';
  let i = start;

  while (i < end) {
    const ch = input[i];

    if (ch === '\\') {
      // ── Backslash: LaTeX command ──
      i++;
      if (i >= end) {
        result += '\\';
        break;
      }

      // Read command name (letters only, or single non-letter)
      const cmdStart = i;
      if (isLetter(input[i])) {
        while (i < end && isLetter(input[i])) i++;
      } else {
        i++; // single-char command like \{ \} \$
      }
      const cmd = input.slice(cmdStart, i);

      // Handle special commands
      if (cmd === 'frac') {
        // \frac{num}{den}
        const num = extractGroup(input, i, end);
        i = num.pos;
        const den = extractGroup(input, i, end);
        i = den.pos;
        result += renderFraction(num.text, den.text);
      } else if (cmd === 'sqrt') {
        // \sqrt{...} or \sqrt[n]{...}
        let n = '';
        if (i < end && input[i] === '[') {
          const bracketEnd = input.indexOf(']', i);
          if (bracketEnd !== -1) {
            n = input.slice(i + 1, bracketEnd);
            i = bracketEnd + 1;
          }
        }
        const body = extractGroup(input, i, end);
        i = body.pos;
        result += renderRoot(n, body.text);
      } else if (cmd === 'text' || cmd === 'mathrm' || cmd === 'mathbf' || cmd === 'mathit' || cmd === 'mathsf' || cmd === 'mathtt') {
        const body = extractGroup(input, i, end);
        i = body.pos;
        result += body.text;
      } else if (ACCENTS[cmd]) {
        // \hat{x} → x̂
        let accentedChar: string;
        if (i < end && input[i] === '{') {
          const body = extractGroup(input, i, end);
          i = body.pos;
          accentedChar = body.text;
        } else if (i < end) {
          accentedChar = input[i];
          i++;
        } else {
          accentedChar = '';
        }
        result += accentedChar + ACCENTS[cmd];
      } else {
        // Lookup command in symbol tables
        result += lookupCommand(cmd);
      }
    } else if (ch === '^') {
      // ── Superscript ──
      i++;
      const sup = parseScriptArg(input, i, end);
      i = sup.pos;
      result += toSuperScript(sup.text);
    } else if (ch === '_') {
      // ── Subscript ──
      i++;
      const sub = parseScriptArg(input, i, end);
      i = sub.pos;
      result += toSubScript(sub.text);
    } else if (ch === '{' || ch === '}') {
      // ── Braces: treat as grouping (skip the brace, parse content, skip closing) ──
      if (ch === '{') {
        i++;
        const depth = 1;
        const groupStart = i;
        // Find matching }
        let d = 1;
        while (i < end && d > 0) {
          if (input[i] === '{') d++;
          else if (input[i] === '}') d--;
          if (d > 0) i++;
        }
        const inner = parse(input, groupStart, i);
        result += inner.text;
        i++; // skip }
      } else {
        // Stray } — pass through
        result += '}';
        i++;
      }
    } else if (ch === '&') {
      // ── Alignment tab ──
      result += '  ';
      i++;
    } else if (ch === '~') {
      // ── Non-breaking space ──
      result += ' ';
      i++;
    } else {
      // ── Regular character ──
      result += ch;
      i++;
    }
  }

  return { text: result, pos: i };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function isLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

/** Extract text between { and } at current position. Returns content and new position. */
function extractGroup(input: string, start: number, end: number): ParseResult {
  if (start >= end || input[start] !== '{') {
    // No braces — take single character or nothing
    if (start < end && input[start] !== '\\' && input[start] !== '^' && input[start] !== '_') {
      return { text: input[start], pos: start + 1 };
    }
    return { text: '', pos: start };
  }

  let i = start + 1;
  let depth = 1;
  while (i < end && depth > 0) {
    if (input[i] === '{') depth++;
    else if (input[i] === '}') depth--;
    if (depth > 0) i++;
  }

  const inner = parse(input, start + 1, i).text;
  return { text: inner, pos: i + 1 };
}

/** Parse a script argument: either a single char or a {...} group. */
function parseScriptArg(input: string, start: number, end: number): ParseResult {
  if (start >= end) return { text: '', pos: start };

  if (input[start] === '{') {
    return extractGroup(input, start, end);
  }

  // Single character (or backslash command)
  if (input[start] === '\\') {
    // Parse one command
    let i = start + 1;
    if (i < end && isLetter(input[i])) {
      while (i < end && isLetter(input[i])) i++;
    } else {
      i++;
    }
    const cmd = input.slice(start + 1, i);
    return { text: lookupCommand(cmd), pos: i };
  }

  return { text: input[start], pos: start + 1 };
}

/** Convert text to superscript Unicode. */
function toSuperScript(text: string): string {
  let result = '';
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') {
      result += SUPER_DIGITS[ch];
    } else if (ch >= 'a' && ch <= 'z') {
      result += SUPER_LOWER[ch] || ch;
    } else if (ch >= 'A' && ch <= 'Z') {
      result += SUPER_LOWER[ch.toLowerCase()] || ch;
    } else if (ch === '+') {
      result += '⁺';
    } else if (ch === '-') {
      result += '⁻';
    } else if (ch === '=') {
      result += '⁼';
    } else if (ch === '(') {
      result += '⁽';
    } else if (ch === ')') {
      result += '⁾';
    } else {
      result += ch;
    }
  }
  return result;
}

/** Convert text to subscript Unicode. */
function toSubScript(text: string): string {
  let result = '';
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') {
      result += SUB_DIGITS[ch];
    } else if (ch >= 'a' && ch <= 'z') {
      result += SUB_LOWER[ch] || ch;
    } else if (ch >= 'A' && ch <= 'Z') {
      result += SUB_LOWER[ch.toLowerCase()] || ch;
    } else if (ch === '+') {
      result += '₊';
    } else if (ch === '-') {
      result += '₋';
    } else if (ch === '=') {
      result += '₌';
    } else if (ch === '(') {
      result += '₍';
    } else if (ch === ')') {
      result += '₎';
    } else {
      result += ch;
    }
  }
  return result;
}

/** Render a fraction using Unicode superscript + fraction slash + subscript. */
function renderFraction(num: string, den: string): string {
  // Only use inline Unicode fraction for very short simple fractions (1-2 chars)
  // that are pure alphanumeric, otherwise use parenthesized form
  const simpleNum = /^[a-zA-Z0-9]{1,2}$/.test(num);
  const simpleDen = /^[a-zA-Z0-9]{1,2}$/.test(den);

  if (simpleNum && simpleDen) {
    return toSuperScript(num) + '⁄' + toSubScript(den);
  }
  // Fallback: inline with parentheses
  return `(${num})/(${den})`;
}

/** Render a root: \sqrt[n]{x} → ⁿ√(x) or √(x) */
function renderRoot(n: string, body: string): string {
  if (n) {
    return toSuperScript(n) + '√(' + body + ')';
  }
  return '√(' + body + ')';
}

/** Look up a LaTeX command in symbol tables. */
function lookupCommand(cmd: string): string {
  // Aliases (e.g. \to → \rightarrow)
  const resolved = COMMAND_ALIASES[cmd] || cmd;

  // Upper Greek
  if (GREEK_UPPER[resolved]) return GREEK_UPPER[resolved];
  // Lower Greek
  if (GREEK_LOWER[resolved]) return GREEK_LOWER[resolved];
  // Math symbols
  if (MATH_SYMBOLS[resolved]) return MATH_SYMBOLS[resolved];

  // Operator names: render as plain text
  if (OPERATOR_NAMES.has(resolved)) {
    return resolved;
  }

  // Font/style commands: \mathbb, \mathcal, \mathfrak, \mathbf, \mathit, \mathrm, \mathsf, \mathtt
  if (resolved === 'mathbb' || resolved === 'mathcal' || resolved === 'mathfrak' ||
      resolved === 'mathbf' || resolved === 'mathit' || resolved === 'mathrm' ||
      resolved === 'mathsf' || resolved === 'mathtt') {
    return ''; // strip, the content will be handled by the group parser
  }

  // Escaped literal characters
  if (resolved === '{') return '{';
  if (resolved === '}') return '}';
  if (resolved === '#') return '#';
  if (resolved === '%') return '%';
  if (resolved === '&') return '&';
  if (resolved === '$') return '$';

  // Common LaTeX commands that don't produce visible output
  if (resolved === 'left' || resolved === 'right' ||
      resolved === 'big' || resolved === 'Big' || resolved === 'bigg' || resolved === 'Bigg') return '';
  if (resolved === 'limits' || resolved === 'nolimits' || resolved === 'displaylimits') return '';
  if (resolved === 'displaystyle' || resolved === 'textstyle' || resolved === 'scriptstyle') return '';
  if (resolved === 'operatorname' || resolved === 'DeclareMathOperator') return '';

  // Spacing commands
  if (resolved === ',') return ' '; // thin space
  if (resolved === ':' || resolved === '>') return '';
  if (resolved === ';') return '';
  if (resolved === '!') return ''; // negative thin space
  if (resolved === 'quad') return ' ';
  if (resolved === 'qquad') return '  ';

  // Unknown — return raw
  return '\\' + cmd;
}
