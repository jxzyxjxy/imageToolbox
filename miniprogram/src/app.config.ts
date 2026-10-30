export default defineAppConfig({
  pages: [
    'pages/index/index',
    // 注意：注册路径必须与源码路径完全一致（源码在 pages/video/index/index.tsx），
    // 注册成 pages/video/index 会导致 Taro 产物劈叉（js 平铺、wxml 嵌套），真机白屏
    'pages/video/index/index',
    'pages/similar/index',
    'pages/compress/index',
    'pages/restore/index',
    'pages/id-photo/index',
    'pages/remove-bg/index',
    'pages/remove-watermark/index',
    'pages/smart-eraser/index',
    'pages/upscale/index',
    'pages/icon-splitter/index',
    'pages/video/compress/index',
    'pages/video/parse/index',
  ],
  tabBar: {
    color: '#94a3b8',
    selectedColor: '#6366f1',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '图片工具',
        iconPath: 'assets/tabbar/pic-off.png',
        selectedIconPath: 'assets/tabbar/pic-on.png',
      },
      {
        pagePath: 'pages/video/index/index',
        text: '视频工具',
        iconPath: 'assets/tabbar/video-off.png',
        selectedIconPath: 'assets/tabbar/video-on.png',
      },
    ],
  },
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
