// Find in page. Wry has no native find API, so matching is delegated to the
// page's own window.find() via the reporter — which means next/previous but
// no match counts. Simple.

import { createEffect, onCleanup } from "solid-js";
import * as ipc from "../ipc";
import { openFindSignal, setUi } from "../state";
import { IconChevronDown, IconChevronUp, IconClose } from "./icons";

export function FindBar() {
  let input!: HTMLInputElement;

  createEffect(() => {
    openFindSignal[0]();
    input.focus();
    input.select();
  });

  const search = (backwards = false) => {
    if (input.value) void ipc.findInPage(input.value, backwards);
  };

  const close = () => {
    void ipc.findClear();
    setUi("none");
  };
  onCleanup(() => void ipc.findClear());

  return (
    <div class="findbar">
      <input
        ref={input}
        type="text"
        placeholder="Find in page"
        spellcheck={false}
        onKeyDown={(e) => {
          if (e.key === "Enter") search(e.shiftKey);
          else if (e.key === "Escape") close();
        }}
      />
      <button class="icon-btn" title="Previous (⇧Enter)" onClick={() => search(true)}>
        <IconChevronUp />
      </button>
      <button class="icon-btn" title="Next (Enter)" onClick={() => search(false)}>
        <IconChevronDown />
      </button>
      <button class="icon-btn" title="Close (Esc)" onClick={close}>
        <IconClose />
      </button>
    </div>
  );
}
