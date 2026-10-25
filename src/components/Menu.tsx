import { useEffect, useRef } from 'react';

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  small?: boolean;
  disabled?: boolean;
}

/** 小弹出菜单：点外面或按 Esc 关闭 */
export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);
  const left = Math.max(4, Math.min(x, window.innerWidth - 184));
  const top = Math.max(4, Math.min(y, window.innerHeight - items.length * 30 - 12));
  return (
    <div className="menu" ref={ref} role="menu" style={{ left, top }} onClick={(e) => e.stopPropagation()}>
      {items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          className={`menu-item${it.danger ? ' danger' : ''}${it.small ? ' small' : ''}`}
          disabled={it.disabled}
          onClick={() => {
            onClose();
            it.onClick();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
