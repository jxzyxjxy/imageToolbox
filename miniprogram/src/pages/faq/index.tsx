import { View, Text } from '@tarojs/components';
import { useState } from 'react';
import './index.scss';

/**
 * 常见问题（手风琴）
 * 内容原则：用户视角、合规口径；不列举具体支持平台（平台列表持续变化），
 * 不透露内部实现细节与已知缺陷。
 */
interface FaqItem {
  q: string;
  a: string;
}

const FAQ_LIST: FaqItem[] = [
  {
    q: '支持解析哪些视频链接？',
    a: '支持主流短视频与社交平台的公开分享链接，复制分享口令或链接粘贴到输入框即可自动识别。具体支持范围以实际使用为准。',
  },
  {
    q: '为什么有的视频解析失败？',
    a: '分享链接通常有时效，过期后会失效；私密、付费或受访问限制的内容暂不支持。建议在对应平台重新生成分享链接后再试。',
  },
  {
    q: '视频怎么保存到相册？',
    a: '解析成功后进入结果页，点击「保存视频」即可。首次使用需授权「保存到相册」权限；若未弹出授权，可在微信设置中找到本小程序开启。',
  },
  {
    q: '生成的图片是 AI 制作的会有标注吗？',
    a: '使用 AI 能力生成的图片均按平台规范标注「AI生成」字样，建议仅用于个人学习、记录与娱乐场景，请勿用于冒充真实影像等不当用途。',
  },
  {
    q: '我的照片会被保存或用于其他用途吗？',
    a: '不会。照片仅用于您选择的当次处理，我们不会将您的照片用于模型训练或任何商业用途，处理完成后即不再使用。',
  },
  {
    q: '为什么使用部分功能前需要同意授权声明？',
    a: '依据相关法律法规，涉及人脸等个人信息的 AI 处理需要获得您的明确授权。弹窗声明是为了保障您的肖像权与个人信息权益。',
  },
  {
    q: '头像和昵称保存在哪里？',
    a: '仅保存在您手机的本地存储中，不会上传服务器；退出登录或清除后即被删除。',
  },
  {
    q: '清除缓存会清除哪些内容？',
    a: '仅清除使用过程中产生的临时数据，不影响登录状态与授权记录，可放心使用。',
  },
];

export default function FaqPage() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const toggle = (idx: number) => {
    setOpenIdx((cur) => (cur === idx ? null : idx));
  };

  return (
    <View className='faq'>
      <View className='faq__card'>
        {FAQ_LIST.map((item, idx) => (
          <View
            key={item.q}
            className={`faq__item ${idx === FAQ_LIST.length - 1 ? 'faq__item--last' : ''}`}
          >
            <View className='faq__q' onClick={() => toggle(idx)}>
              <Text className='faq__q-text'>{item.q}</Text>
              <Text
                className={`faq__q-arrow ${openIdx === idx ? 'faq__q-arrow--open' : ''}`}
              >
                ⌄
              </Text>
            </View>
            {openIdx === idx && (
              <View className='faq__a'>
                <Text className='faq__a-text'>{item.a}</Text>
              </View>
            )}
          </View>
        ))}
      </View>

      <Text className='faq__tip'>如仍有疑问，可通过「关于我们」了解或在小程序内反馈</Text>
    </View>
  );
}
