import { useCamera } from '../store/board';
import { fitToContent, zoomBy } from './Canvas';
import { Icon } from './ui/Icon';

export function ZoomControls() {
  const z = useCamera((s) => s.z);
  return (
    <div className="zoom panel" role="group" aria-label="Zoom">
      <button className="icon-btn sm" onClick={() => zoomBy(0.8)} aria-label="Zoom out">
        <Icon name="minus" size={15} />
      </button>
      <button className="zoom-pct mono" onClick={() => zoomBy(1 / z)} title="Reset to 100% (⌘0)">
        {Math.round(z * 100)}%
      </button>
      <button className="icon-btn sm" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
        <Icon name="plus" size={15} />
      </button>
      <button className="icon-btn sm" onClick={() => fitToContent()} title="Fit everything (⇧1)" aria-label="Fit to content">
        <Icon name="fit" size={15} />
      </button>
    </div>
  );
}
