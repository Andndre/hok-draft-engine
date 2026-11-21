import React from 'react';

interface ColoredTextProps {
  text: string;
  className?: string;
}

/**
 * Parses Unity/HoK in-game markup tags `<color=#hex>content</color>`
 * and renders them safely as typed React inline elements.
 */
export function renderColoredText(text: string): React.ReactNode {
  if (!text) return null;

  // Pattern matches <color=#hex>...</color> or <color=colorName>...</color>
  const regex = /<color=([#a-zA-Z0-9]+)>(.*?)<\/color>/gi;
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let hasMatch = false;

  while ((match = regex.exec(text)) !== null) {
    hasMatch = true;
    const [fullMatch, rawColor, content] = match;
    const matchStart = match.index;

    // Push unformatted plain text before this tag
    if (matchStart > lastIndex) {
      elements.push(text.slice(lastIndex, matchStart));
    }

    // Normalize color code
    const color = rawColor.startsWith('#') || /^[a-zA-Z]+$/.test(rawColor) ? rawColor : `#${rawColor}`;

    elements.push(
      <span
        key={`colored-${matchStart}`}
        style={{ color }}
        className="font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
      >
        {content}
      </span>
    );

    lastIndex = matchStart + fullMatch.length;
  }

  if (!hasMatch) {
    return text;
  }

  // Push remaining plain text
  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  return elements;
}

export const ColoredText: React.FC<ColoredTextProps> = ({ text, className = '' }) => {
  return (
    <span className={`whitespace-pre-line leading-relaxed ${className}`}>
      {renderColoredText(text)}
    </span>
  );
};

export default ColoredText;
