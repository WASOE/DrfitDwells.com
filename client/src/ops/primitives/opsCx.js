import './opsPrimitives.css';

export function opsCx(...parts) {
  return parts.flat().filter(Boolean).join(' ');
}
