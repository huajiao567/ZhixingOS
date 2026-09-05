# Contributing

感谢你帮助知行镜成为更可靠、普适且尊重人的个人智能环境。

## 开始前

1. 阅读 `README.md`、`ARCHITECTURE.md`、`PRIVACY.md` 和 `CODE_OF_CONDUCT.md`。
2. 对架构、数据模型、高影响执行器或隐私边界的改变，先开 Issue 写清问题、用户价值、替代方案、迁移和回滚。
3. 不要在 Issue、测试夹具、截图或提交中放真实个人数据、访问令牌、模型密钥或私人项目书。

## 本地验证

```powershell
npm install
npm --prefix backend install
npm run check
npm run doctor
npm run build:web
npm run audit:open-source
```

涉及界面时再运行 `npm run test:mobile`；涉及原生权限时附真机平台、系统版本、授权/拒绝/撤回三种结果。电脑模拟器不能代替真机权限测试。

## 提交要求

- 保持 TypeScript strict，无 `any` 式绕过关键领域契约。
- 新行为先写失败测试，再实现最小完整变更。
- 不以静默 fallback、占位成功、跳过测试或删除功能来让验收变绿。
- 动作结果必须区分 success、partial_failure、failed、blocked 和 undone。
- 对用户的推断必须有来源、范围、反证、复审与纠正路径。
- 新依赖说明用途、许可证、体积、权限和可替代性。
- 更新 `CHANGELOG.md` 和受影响的追踪/验证文档。

## Pull Request 清单

- [ ] 问题和非目标清晰。
- [ ] 测试先失败后通过，或说明为何不适用。
- [ ] 前后端类型检查通过。
- [ ] 无密钥、数据库、日志、构建产物或真实个人数据。
- [ ] 权限、隐私、无障碍和失败状态已覆盖。
- [ ] 数据迁移向后兼容且有回滚策略。
- [ ] 第三方素材和代码许可证兼容。

