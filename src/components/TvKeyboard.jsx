import { useEffect, useRef, useState } from "react";
import { setGamepadFocus } from "../utils/gamepadSpatialNav";

const LETTER_ROWS = ["abcdef", "ghijkl", "mnopqr", "stuvwx", "yz"];
const NUMBER_ROWS = ["123456", "7890-.", "@#$%&*", "+=()?!", `'":,/_`];

let activeField = null;
let nextFocus = null;

export function isTvKeyboardOpen() {
  return !!document.querySelector(".tv-keyboard");
}

export function requestTvKeyboard(field) {
  if (activeField || isTvKeyboardOpen()) return;
  activeField = field;
  window.dispatchEvent(
    new CustomEvent("streambert:keyboard-open", { detail: field }),
  );
}

export function closeTvKeyboard(focusEl) {
  if (!activeField && !isTvKeyboardOpen()) return false;
  nextFocus = focusEl instanceof HTMLElement ? focusEl : null;
  activeField = null;
  window.dispatchEvent(new Event("streambert:keyboard-close"));
  return true;
}

function writeField(field, value, caret) {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(field, value);
  else field.value = value;
  try {
    field.setSelectionRange(caret, caret);
  } catch {
    /* number inputs reject a selection */
  }
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function RemoteIcon({ name }) {
  const common = {
    viewBox: "0 0 24 24",
    "aria-hidden": "true",
    focusable: "false",
  };
  if (name === "rewind") {
    return (
      <svg {...common}>
        <path d="M11 5 L4 12 L11 19 Z" />
        <path d="M20 5 L13 12 L20 19 Z" />
      </svg>
    );
  }
  if (name === "forward") {
    return (
      <svg {...common}>
        <path d="M4 5 L11 12 L4 19 Z" />
        <path d="M13 5 L20 12 L13 19 Z" />
      </svg>
    );
  }
  if (name === "play") {
    return (
      <svg {...common}>
        <path d="M3 5 L12 12 L3 19 Z" />
        <path d="M14 5 H17 V19 H14 Z" />
        <path d="M19 5 H22 V19 H19 Z" />
      </svg>
    );
  }
  if (name === "menu") {
    return (
      <svg {...common}>
        <path d="M3 6 H21 V8.2 H3 Z" />
        <path d="M3 11 H21 V13.2 H3 Z" />
        <path d="M3 16 H21 V18.2 H3 Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M20 10.5 H8.2 L12.6 6.1 L11 4.5 L4 11.5 L11 18.5 L12.6 16.9 L8.2 12.5 H20 Z" />
    </svg>
  );
}

function Key({ children, span = 1, onPress, remote }) {
  return (
    <button
      type="button"
      className="tv-keyboard__key"
      style={span > 1 ? { gridColumn: `span ${span}` } : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
    >
      <span>{children}</span>
      {remote ? (
        <span className="tv-keyboard__remote">
          <RemoteIcon name={remote} />
        </span>
      ) : null}
    </button>
  );
}

export function TvKeyboard() {
  const [field, setField] = useState(null);
  const [mode, setMode] = useState("letters");
  const [caps, setCaps] = useState(false);
  const caretRef = useRef(0);
  const fieldRef = useRef(null);
  const actionsRef = useRef({});

  useEffect(() => {
    const open = (event) => {
      const next = event.detail;
      if (
        !(next instanceof HTMLInputElement) &&
        !(next instanceof HTMLTextAreaElement)
      ) {
        activeField = null;
        return;
      }
      fieldRef.current = next;
      caretRef.current = next.value?.length ?? 0;
      setCaps(false);
      setMode("letters");
      setField(next);
      next.scrollIntoView({ block: "center", behavior: "auto" });
    };
    const close = () => {
      const previous = fieldRef.current;
      const target = nextFocus;
      nextFocus = null;
      fieldRef.current = null;
      setField(null);
      requestAnimationFrame(() => {
        if (target && document.contains(target)) {
          setGamepadFocus(target, { scroll: false });
          window.dispatchEvent(new Event("streambert:tv-moved"));
          return;
        }
        if (previous instanceof HTMLElement && document.contains(previous)) {
          setGamepadFocus(previous, { scroll: false });
          window.dispatchEvent(new Event("streambert:tv-moved"));
        }
      });
    };
    window.addEventListener("streambert:keyboard-open", open);
    window.addEventListener("streambert:keyboard-close", close);
    const onCommand = (event) => {
      const run = actionsRef.current[event.detail];
      if (typeof run === "function") run();
    };
    window.addEventListener("streambert:keyboard-command", onCommand);
    return () => {
      window.removeEventListener("streambert:keyboard-open", open);
      window.removeEventListener("streambert:keyboard-close", close);
      window.removeEventListener("streambert:keyboard-command", onCommand);
    };
  }, []);

  useEffect(() => {
    if (!field) return undefined;
    document.documentElement.dataset.tvKeyboard = "1";
    const frame = requestAnimationFrame(() => {
      const first = document.querySelector(".tv-keyboard__key");
      if (first instanceof HTMLElement) setGamepadFocus(first, { scroll: false });
    });
    return () => {
      cancelAnimationFrame(frame);
      delete document.documentElement.dataset.tvKeyboard;
    };
  }, [field, mode]);

  if (!field) return null;

  const insert = (text) => {
    const current = fieldRef.current;
    if (!current || !document.contains(current)) return;
    const value = current.value || "";
    const caret = Math.min(caretRef.current ?? value.length, value.length);
    const next = value.slice(0, caret) + text + value.slice(caret);
    caretRef.current = caret + text.length;
    writeField(current, next, caretRef.current);
  };

  const removeChar = () => {
    const current = fieldRef.current;
    if (!current || !document.contains(current)) return;
    const value = current.value || "";
    const caret = Math.min(caretRef.current ?? value.length, value.length);
    if (caret === 0) return;
    const next = value.slice(0, caret - 1) + value.slice(caret);
    caretRef.current = caret - 1;
    writeField(current, next, caretRef.current);
  };

  const clear = () => {
    const current = fieldRef.current;
    if (!current || !document.contains(current)) return;
    caretRef.current = 0;
    writeField(current, "", 0);
  };

  actionsRef.current = {
    delete: removeChar,
    space: () => insert(" "),
    charset: () =>
      setMode((current) => (current === "letters" ? "numbers" : "letters")),
    caps: () => setCaps((on) => !on),
  };

  const letters = mode === "letters";
  const rows = letters ? LETTER_ROWS : NUMBER_ROWS;

  return (
    <div className="tv-keyboard" role="group" aria-label="Keyboard">
      {rows.map((row) => (
        <div className="tv-keyboard__row" key={row}>
          {Array.from(row).map((char, index) => {
            const shown = letters && caps ? char.toUpperCase() : char;
            return (
              <Key
                key={`${row}-${index}`}
                onPress={() => insert(shown === " " ? " " : shown)}
              >
                {shown === " " ? "Space" : shown}
              </Key>
            );
          })}
        </div>
      ))}
      <div className="tv-keyboard__row">
        {letters ? (
          <Key remote="menu" onPress={() => setCaps((on) => !on)}>
            {caps ? "abc" : "ABC"}
          </Key>
        ) : (
          <Key remote="play" onPress={() => setMode("letters")}>
            abc
          </Key>
        )}
        {letters ? (
          <Key remote="play" onPress={() => setMode("numbers")}>
            123
          </Key>
        ) : (
          <Key onPress={() => insert("@")}>@</Key>
        )}
        <Key remote="forward" onPress={() => insert(" ")}>
          Space
        </Key>
        <Key remote="rewind" onPress={removeChar}>
          Delete
        </Key>
        <Key onPress={clear}>Clear</Key>
        <Key remote="back" onPress={() => closeTvKeyboard()}>
          Done
        </Key>
      </div>
    </div>
  );
}
