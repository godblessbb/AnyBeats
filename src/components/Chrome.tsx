import { useEffect, useState } from 'react';
import { useEditor } from './services';

/** 一句提示（涂不上、锁住了、合并了颜色等），显示 4 秒 */
export function Toast() {
  const s = useEditor();
  const [hidden, setHidden] = useState<number | null>(null);
  const at = s.notice?.at ?? null;
  useEffect(() => {
    if (at === null) return;
    const id = setTimeout(() => setHidden(at), 4000);
    return () => clearTimeout(id);
  }, [at]);
  if (!s.notice || hidden === at) return null;
  return (
    <div className="toast" role="status" data-role="toast">
      {s.notice.text}
    </div>
  );
}
