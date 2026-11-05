# vendored dsh-pet (Oasis)

来源：本机已安装的 dsh-pet（第三方桌宠插件），用于 Oasis 桌宠宿主。
这里只 vendor 代码（lib/runtime/src/scripts），不含 60MB assets；运行时仍需 assets。
下一步：
1. 把 assets 链接/复制到 Oasis 数据目录；
2. 用 Oasis 品牌/identity 注入替换 node_modules 手补；
3. 打补丁脚本迁到 vendor/dsh-pet，不再改 node_modules。
