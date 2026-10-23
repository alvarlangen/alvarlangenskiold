import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { suggest, type NameIndex } from '../game/matching';

interface Props {
  index: NameIndex;
  placeholder: string;
  suggestionsOn: boolean;
  disabled?: boolean;
  shake: number;
  onSubmit: (text: string) => void;
  onFocusChange?: (focused: boolean) => void;
  onType?: () => void;
  inputRef?: { current: HTMLInputElement | null };
}

/**
 * Free-text guess field. The optional suggestion list is only a typing aid (ARIA combobox);
 * the player always types — there are no ready-made answer buttons.
 */
export function GuessForm({
  index,
  placeholder,
  suggestionsOn,
  disabled,
  shake,
  onSubmit,
  onFocusChange,
  onType,
  inputRef,
}: Props) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [shaking, setShaking] = useState(false);
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;

  const items = useMemo(() => (suggestionsOn ? suggest(index, value) : []), [index, value, suggestionsOn]);
  const showList = open && items.length > 0 && !disabled;

  useEffect(() => {
    if (!shake) return;
    setShaking(true);
    const t = setTimeout(() => setShaking(false), 450);
    return () => clearTimeout(t);
  }, [shake]);

  useEffect(() => setActive(-1), [value]);

  const submit = (text: string) => {
    if (!text.trim() || disabled) return;
    onSubmit(text);
    setValue('');
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent) => {
    if (!showList) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Tab' && active >= 0) {
      e.preventDefault();
      setValue(items[active].value);
    }
  };

  return (
    <form
      class="guess-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit(active >= 0 && showList ? items[active].value : value);
      }}
      autocomplete="off"
    >
      {showList && (
        <ul class="suggestions" id="guess-list" role="listbox" aria-label="Suggestions">
          {items.map((s, i) => (
            <li
              key={s.id}
              id={`sug-${i}`}
              role="option"
              aria-selected={i === active}
              onPointerDown={(e) => {
                e.preventDefault();
                setValue(s.value);
                setOpen(false);
                ref.current?.focus();
              }}
            >
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div class="guess-field">
        <label for="guess" class="sr-only">
          {placeholder}
        </label>
        <input
          id="guess"
          ref={ref}
          class={`guess-input${shaking ? ' shake' : ''}`}
          type="text"
          inputMode="text"
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          spellcheck={false}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls="guess-list"
          aria-activedescendant={active >= 0 && showList ? `sug-${active}` : undefined}
          onInput={(e) => {
            setValue((e.target as HTMLInputElement).value);
            setOpen(true);
            onType?.();
          }}
          onKeyDown={onKey}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => {
            onFocusChange?.(false);
            setTimeout(() => setOpen(false), 150);
          }}
        />
      </div>
      <button class="btn btn-primary" type="submit" disabled={disabled || !value.trim()} style={{ minHeight: '52px' }}>
        Guess
      </button>
    </form>
  );
}
