/**
 * 个人空间 DTO（对应 GET/PUT /api/personal-space）
 * 未配置的 RustDesk 可空字段由服务端统一输出为空字符串。
 */
export interface PersonalSpaceDto {
  id: number
  spaceName: string
  rustdeskIdServer: string
  rustdeskRelayServer: string
  rustdeskKey: string
  rustdeskWebClient: string
  createdAt: string
  updatedAt: string
}

/** PUT /api/personal-space 请求体 */
export interface PersonalSpaceUpdateInput {
  spaceName: string
  rustdeskIdServer: string
  rustdeskRelayServer: string
  rustdeskKey: string
  rustdeskWebClient: string
}
