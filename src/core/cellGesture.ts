/**
 * 格子上的鼠标手势：单击选中并进入编辑，双击切换重音。
 *
 * 浏览器的双击事件序列是 click → click → dblclick：第一下 click 已经进入编辑，
 * 所以双击不能要求「不在编辑中」（旧界面就是这样永远不成立）。这里双击无条件切换重音，
 * 并退出这次手势里打开的编辑框。
 */

export interface GestureTarget {
  /** 格子或片段的稳定标识 */
  id: string;
  hasText: boolean;
}

export interface GestureState {
  selected: string | null;
  editing: string | null;
}

export type GestureEvent =
  | { type: 'click'; target: GestureTarget }
  | { type: 'dblclick'; target: GestureTarget }
  | { type: 'commit' }
  | { type: 'cancel' };

export type GestureEffect = { type: 'toggleAccent'; id: string };

export const initialGestureState: GestureState = { selected: null, editing: null };

export function reduceGesture(
  state: GestureState,
  event: GestureEvent,
): { state: GestureState; effects: GestureEffect[] } {
  switch (event.type) {
    case 'click':
      if (state.editing === event.target.id) return { state, effects: [] };
      return { state: { selected: event.target.id, editing: event.target.id }, effects: [] };
    case 'dblclick':
      return {
        state: { selected: event.target.id, editing: null },
        effects: event.target.hasText ? [{ type: 'toggleAccent', id: event.target.id }] : [],
      };
    case 'commit':
    case 'cancel':
      return { state: { ...state, editing: null }, effects: [] };
  }
}
