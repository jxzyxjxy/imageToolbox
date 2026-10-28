export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/similar/index',
    'pages/compress/index',
    'pages/restore/index',
    'pages/id-photo/index',
    'pages/remove-bg/index',
    'pages/remove-watermark/index',
    'pages/smart-eraser/index',
    'pages/upscale/index',
    'pages/icon-splitter/index',
  ],
  // 组件按需注入：减小启动包体积，发布检测要求
  lazyCodeLoading: 'requiredComponents',
  window: {
    backgroundTextStyle: 'light',
    backgroundColor: '#f5f6fa',
    navigationBarBackgroundColor: '#6366f1',
    navigationBarTitleText: '青芽影图',
    navigationBarTextStyle: 'white',
  },
});
