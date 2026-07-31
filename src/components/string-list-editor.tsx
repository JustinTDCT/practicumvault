"use client";

interface StringListEditorProps {
  label: string;
  description?: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  addLabel?: string;
  itemLabel?: string;
}

export function StringListEditor({
  label,
  description,
  items,
  onChange,
  placeholder = "Enter fact…",
  disabled = false,
  addLabel = "Add item",
  itemLabel = "Item",
}: StringListEditorProps) {
  function updateItem(index: number, value: string) {
    const next = [...items];
    next[index] = value;
    onChange(next);
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  return (
    <div className="form-group">
      <label>{label}</label>
      {description && (
        <p style={{ color: "var(--text-muted)", fontSize: 14, margin: "0 0 8px" }}>{description}</p>
      )}
      {items.map((item, i) => (
        <div key={i} className="card-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ color: "var(--text-faint)", fontSize: "0.8125rem", fontWeight: 600 }}>
              {itemLabel} {i + 1}
            </span>
            {!disabled && (
              <button
                className="btn btn-danger btn-sm"
                type="button"
                onClick={() => removeItem(i)}
              >
                Remove
              </button>
            )}
          </div>
          <input
            value={item}
            placeholder={placeholder}
            onChange={(e) => updateItem(i, e.target.value)}
            disabled={disabled}
          />
        </div>
      ))}
      {!disabled && (
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => onChange([...items, ""])}
        >
          {addLabel}
        </button>
      )}
    </div>
  );
}
