# 康复病历工作台 · PWA 站点

本仓库只存放部署流水线，站点内容由 `site.zip` 自动解包发布，请勿直接改站内文件。

## Pages 两种发布方式都已支持

- 若 Pages 的 Source 选的是 **GitHub Actions**，流水线里的 `deploy-pages` 会直接发布。
- 若 Source 选的是 **Deploy from a branch -> gh-pages**，分支推送后 GitHub 会自己构建发布。

两种任选一种即可，不需要改代码。

## 说明

- 访问地址：https://xcaihgga.github.io/rehab-desk-pwa/
- 数据只保存在访问者本机浏览器 localStorage，服务器不保存任何病例数据。
- 站点包更新：替换 `site.zip` 地址后重新提交即可。
