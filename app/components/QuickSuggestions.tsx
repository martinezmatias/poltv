"use client";

type QuickSuggestionsProps = {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  disabled?: boolean;
};

export function QuickSuggestions({ suggestions, onSelect, disabled = false }: QuickSuggestionsProps) {
  const visible = suggestions.filter(Boolean).slice(0, 4);
  if (visible.length === 0) return null;

  return (
    <div className="quick-suggestions" aria-label="Suggested replies">
      {visible.map((suggestion) => (
        <button
          type="button"
          className="suggestion-chip"
          key={suggestion}
          onClick={() => onSelect(suggestion)}
          disabled={disabled}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}
