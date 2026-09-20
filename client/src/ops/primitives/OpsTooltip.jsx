import { Children, cloneElement, isValidElement, useId, useState } from 'react';
import { opsCx } from './opsCx';

const SIDES = ['top', 'right', 'bottom', 'left'];

function joinDescribedBy(...values) {
  const ids = [];
  for (const value of values) {
    for (const id of String(value || '').split(/\s+/)) {
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids.join(' ') || undefined;
}

function composeHandlers(theirHandler, ourHandler) {
  return (event) => {
    theirHandler?.(event);
    ourHandler(event);
  };
}

/**
 * Quiet label tooltip. The child remains the accessible control.
 * Default side is top; collapsed sidebar will pass side="right".
 */
export default function OpsTooltip({ content, children, side = 'top', disabled = false }) {
  const tooltipId = useId();
  const [fromFocus, setFromFocus] = useState(false);
  const [fromPointer, setFromPointer] = useState(false);
  const child = Children.only(children);
  const resolvedSide = SIDES.includes(side) ? side : 'top';
  const canShow = Boolean(!disabled && content != null && content !== '');
  const visible = canShow && (fromFocus || fromPointer);

  if (!isValidElement(child)) {
    throw new Error('OpsTooltip requires a single React element child');
  }

  function showFromFocus() {
    if (canShow) setFromFocus(true);
  }

  function hideFromFocus() {
    setFromFocus(false);
  }

  function showFromPointer() {
    if (canShow) setFromPointer(true);
  }

  function hideFromPointer() {
    setFromPointer(false);
  }

  function hideAll() {
    setFromFocus(false);
    setFromPointer(false);
  }

  function handleKeyDown(event) {
    if (event.key !== 'Escape') return;
    if (!fromFocus && !fromPointer) return;
    event.preventDefault();
    event.stopPropagation();
    hideAll();
  }

  const trigger = cloneElement(child, {
    'aria-describedby': joinDescribedBy(child.props['aria-describedby'], visible ? tooltipId : null),
    onFocus: composeHandlers(child.props.onFocus, showFromFocus),
    onBlur: composeHandlers(child.props.onBlur, hideFromFocus),
    onPointerEnter: composeHandlers(child.props.onPointerEnter, showFromPointer),
    onPointerLeave: composeHandlers(child.props.onPointerLeave, hideFromPointer),
    onMouseEnter: composeHandlers(child.props.onMouseEnter, showFromPointer),
    onMouseLeave: composeHandlers(child.props.onMouseLeave, hideFromPointer),
    onKeyDown: composeHandlers(child.props.onKeyDown, handleKeyDown)
  });

  return (
    <span className="ops-tooltip">
      {trigger}
      {visible ? (
        <span
          id={tooltipId}
          role="tooltip"
          className={opsCx('ops-tooltip__content', `ops-tooltip__content--${resolvedSide}`)}
          data-side={resolvedSide}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}

export const OPS_TOOLTIP_SIDES = SIDES;
