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
    'pages/video/result/index',
    'pages/profile/index',
    'pages/faq/index',
  ],
  tabBar: {
    // 自定义 tabBar：实测该环境下官方 tabBar 图标文件（png/jpg 各种编码形态）全部裂图——
    // 「从代码包加载图标文件」这条机制本身不可用，故用组件自绘 + base64 内联图标，
    // 从机制上消除文件加载环节；切页与高亮同步均事件总线（页面上下文执行，带全路径兜底）。
    // list 的 iconPath 仍需合法（页面注册依赖 list），jpg 文件保留在包内。
    custom: true,
    color: '#94a3b8',
    selectedColor: '#6366f1',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '图片工具',
        iconPath: 'assets/tabbar/pic-off.jpg',
        selectedIconPath: 'assets/tabbar/pic-on.jpg',
      },
      {
        pagePath: 'pages/video/index/index',
        text: '视频工具',
        iconPath: 'assets/tabbar/video-off.jpg',
        selectedIconPath: 'assets/tabbar/video-on.jpg',
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        // iconPath 仅要求文件存在（custom: true 后真实渲染走 base64），复用现有文件
        iconPath: 'assets/tabbar/pic-off.jpg',
        selectedIconPath: 'assets/tabbar/pic-on.jpg',
      },
    ],
  },
  // 组件按需注入：发布体检要求开启。与 custom-tab-bar + base64 图标方案兼容
  // （历史上 15bd236~79b0e04 期间两者共存运行正常；图标走 base64 内联渲染，不依赖资源注入机制）
  lazyCodeLoading: 'requiredComponents',
  window: {
    backgroundTextStyle: 'light',
    backgroundColor: '#f5f6fa',
    navigationBarBackgroundColor: '#6366f1',
    navigationBarTitleText: '青芽影图',
    navigationBarTextStyle: 'white',
  },
});
