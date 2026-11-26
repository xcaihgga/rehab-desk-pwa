# 康复病历工作台 · PWA 站点

本仓库只存放部署流水线，站点内容由 `site.zip` 自动解包发布，请勿直接改站内文件。

## 首次上线需要一次开关

GitHub 安全策略不允许流水线自动创建 Pages 站点，需要仓库所有者在网页上点一次：

Settings - Pages - Build and deployment - Source 选择 **GitHub Actions**（无需保存，选完即生效）。

开关打开后，本仓库的定时任务（每 10 分钟）会自动完成部署，无需再次操作。

## 说明

- 访问地址：https://xcaihgga.github.io/rehab-desk-pwa/
- 数据只保存在访问者本机浏览器 localStorage，服务器不保存任何病例数据。
- 站点包更新：替换 `site.zip` 地址后重新提交即可。
