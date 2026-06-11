import { describe, expect, it } from 'vitest';
import { renderLatex } from '../../src/tui/components/latex-to-unicode.js';

describe('renderLatex', () => {
  describe('Greek letters', () => {
    it('should convert lowercase greek', () => {
      expect(renderLatex('\\alpha')).toBe('α');
      expect(renderLatex('\\beta')).toBe('β');
      expect(renderLatex('\\pi')).toBe('π');
      expect(renderLatex('\\omega')).toBe('ω');
    });

    it('should convert uppercase greek', () => {
      expect(renderLatex('\\Gamma')).toBe('Γ');
      expect(renderLatex('\\Delta')).toBe('Δ');
      expect(renderLatex('\\Omega')).toBe('Ω');
    });
  });

  describe('Math symbols', () => {
    it('should convert operators', () => {
      expect(renderLatex('\\times')).toBe('×');
      expect(renderLatex('\\cdot')).toBe('·');
      expect(renderLatex('\\pm')).toBe('±');
      expect(renderLatex('\\div')).toBe('÷');
    });

    it('should convert relations', () => {
      expect(renderLatex('\\leq')).toBe('≤');
      expect(renderLatex('\\geq')).toBe('≥');
      expect(renderLatex('\\neq')).toBe('≠');
      expect(renderLatex('\\approx')).toBe('≈');
    });

    it('should convert arrows', () => {
      expect(renderLatex('\\to')).toBe('→');
      expect(renderLatex('\\rightarrow')).toBe('→');
      expect(renderLatex('\\leftarrow')).toBe('←');
      expect(renderLatex('\\Rightarrow')).toBe('⇒');
    });

    it('should convert special symbols', () => {
      expect(renderLatex('\\infty')).toBe('∞');
      expect(renderLatex('\\partial')).toBe('∂');
      expect(renderLatex('\\nabla')).toBe('∇');
      expect(renderLatex('\\forall')).toBe('∀');
      expect(renderLatex('\\exists')).toBe('∃');
    });
  });

  describe('Superscript', () => {
    it('should convert x^2', () => {
      expect(renderLatex('x^2')).toBe('x²');
    });

    it('should convert e^{i\\pi}', () => {
      expect(renderLatex('e^{i\\pi}')).toBe('eⁱπ');
    });
  });

  describe('Subscript', () => {
    it('should convert x_1', () => {
      expect(renderLatex('x_1')).toBe('x₁');
    });

    it('should convert a_{ij}', () => {
      expect(renderLatex('a_{ij}')).toBe('aᵢⱼ');
    });
  });

  describe('Fractions', () => {
    it('should convert simple fractions', () => {
      const result = renderLatex('\\frac{1}{2}');
      // ¹⁄₂ (Unicode superscript 1 + fraction slash + subscript 2)
      expect(result).toContain('⁄');
      expect(result).toContain('¹');
      expect(result).toContain('₂');
    });

    it('should handle complex fractions', () => {
      const result = renderLatex('\\frac{a+b}{c+d}');
      expect(result).toContain('a+b');
      expect(result).toContain('c+d');
    });
  });

  describe('Roots', () => {
    it('should convert square root', () => {
      expect(renderLatex('\\sqrt{x}')).toBe('√(x)');
    });

    it('should convert nth root', () => {
      const result = renderLatex('\\sqrt[3]{x}');
      expect(result).toContain('√(x)');
      expect(result).toContain('³');
    });
  });

  describe('Accents', () => {
    it('should convert hat', () => {
      expect(renderLatex('\\hat{x}')).toBe('x̂');
    });

    it('should convert bar', () => {
      expect(renderLatex('\\bar{x}')).toBe('x̄');
    });

    it('should convert vec', () => {
      expect(renderLatex('\\vec{v}')).toBe('v⃗');
    });

    it('should convert tilde', () => {
      expect(renderLatex('\\tilde{n}')).toBe('ñ');
    });
  });

  describe('Big operators', () => {
    it('should convert sum', () => {
      expect(renderLatex('\\sum')).toBe('∑');
    });

    it('should convert int', () => {
      expect(renderLatex('\\int')).toBe('∫');
    });
  });

  describe('Text commands', () => {
    it('should pass through text content', () => {
      expect(renderLatex('\\text{hello}')).toBe('hello');
    });

    it('should handle mathrm', () => {
      expect(renderLatex('\\mathrm{sin}')).toBe('sin');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty input', () => {
      expect(renderLatex('')).toBe('');
    });

    it('should pass through plain text unchanged', () => {
      expect(renderLatex('hello world')).toBe('hello world');
    });

    it('should handle backslash at end of input', () => {
      expect(renderLatex('\\')).toBe('\\');
    });

    it('should convert non-breaking space', () => {
      expect(renderLatex('a~b')).toBe('a b');
    });

    it('should convert alignment tabs to spaces', () => {
      expect(renderLatex('a&b')).toBe('a  b');
    });
  });

  describe('Complex expressions', () => {
    it('should render inline math', () => {
      const result = renderLatex('O(n^2)');
      expect(result).toBe('O(n²)');
    });

    it('should render sum with limits', () => {
      const result = renderLatex('\\sum_{i=1}^{n}');
      expect(result).toContain('∑');
    });

    it('should render escaped braces', () => {
      const result = renderLatex('\\{1, 2, 3\\}');
      expect(result).toContain('{');
      expect(result).toContain('}');
    });
  });
});
