import EraserPage from '../../components/EraserPage';
import './index.scss';

export default function SmartEraser() {
  return (
    <EraserPage
      mode="object"
      title="AI 智能消除"
      subtitle="圈选路人或杂物，一键无痕移除"
      bannerClass="banner--pink"
      maskColor="#ec4899"
      hint="在图片上涂抹覆盖多余的人物或杂物，AI 将无痕移除并补全背景"
    />
  );
}
