import EraserPage from '../../components/EraserPage';
import './index.scss';

export default function RemoveWatermark() {
  return (
    <EraserPage
      mode="watermark"
      title="AI 图片去水印"
      subtitle="涂抹水印区域，智能填补还原"
      bannerClass="banner--amber"
      maskColor="#f59e0b"
      hint="在图片上涂抹覆盖水印、文字或 Logo，AI 将自动填补还原"
    />
  );
}
