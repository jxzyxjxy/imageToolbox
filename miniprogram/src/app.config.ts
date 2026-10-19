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
  window: {
    backgroundTextStyle: 'light',
    backgroundColor: '#f5f6fa',
    navigationBarBackgroundColor: '#6366f1',
    navigationBarTitleText: '图片工具箱',
    navigationBarTextStyle: 'white',
  },
});
