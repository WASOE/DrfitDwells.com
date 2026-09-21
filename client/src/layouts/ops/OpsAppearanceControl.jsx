import { useEffect, useId, useRef, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import OpsIconButton from '../../ops/primitives/OpsIconButton';
import { useOpsAppearance } from '../../ops/appearance/OpsAppearanceProvider';
import { OPS_APPEARANCE_MODES } from '../../ops/appearance/opsAppearance';

const MODE_META = {
  system: { label: 'System', Icon: Monitor },
  light: { label: 'Light', Icon: Sun },
  dark: { label: 'Dark', Icon: Moon }
};

export default function OpsAppearanceControl({ className = '' }) {
  const { mode, appearance, setMode } = useOpsAppearance();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuId = useId();
  const CurrentIcon = MODE_META[mode]?.Icon || Monitor;
  const triggerLabel = `Appearance: ${MODE_META[mode]?.label || 'System'}. Current theme ${appearance}.`;

  useEffect(() => {
    if (!open) return undefined;

    function onKeyDown(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }

    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  function selectMode(next) {
    setMode(next);
    setOpen(false);
    window.setTimeout(() => {
      triggerRef.current?.focus();
    }, 0);
  }

  return (
    <div ref={rootRef} className={`ops-appearance-control ${className}`.trim()} data-testid="ops-appearance-control">
      <OpsIconButton
        ref={triggerRef}
        label={triggerLabel}
        className="ops-appearance-control__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        data-testid="ops-appearance-trigger"
      >
        <CurrentIcon className="ops-appearance-control__icon" aria-hidden="true" strokeWidth={1.75} />
      </OpsIconButton>
      {open ? (
        <ul
          id={menuId}
          role="menu"
          aria-label="Appearance"
          className="ops-appearance-control__menu"
          data-testid="ops-appearance-menu"
        >
          {OPS_APPEARANCE_MODES.map((value) => {
            const meta = MODE_META[value];
            const Icon = meta.Icon;
            const selected = mode === value;
            return (
              <li key={value} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={`ops-appearance-control__option${selected ? ' ops-appearance-control__option--selected' : ''}`}
                  onClick={() => selectMode(value)}
                  data-testid={`ops-appearance-option-${value}`}
                >
                  <Icon className="ops-appearance-control__option-icon" aria-hidden="true" strokeWidth={1.75} />
                  <span>{meta.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
