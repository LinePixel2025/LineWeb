# Task 13: 实现详情面板优化

## 项目上下文
这是网盘前端界面重构项目的第十三步（最后一步）。项目采用React 19 + TypeScript + Vite技术栈。Task 1-12已完成基础架构和UI组件。

## 任务目标
实现详情面板优化，显示更丰富的文件信息和预览功能。

## 文件列表
- Modify: `client/src/components/drive/DriveDetailPanel.tsx`
- Create: `client/src/components/drive/FileAttributes.tsx`
- Modify: `client/src/styles/drive.css`

## 接口定义
- Consumes: `useDrive` - 获取选中文件状态
- Produces: 优化后的详情面板组件

## 详细步骤

### Step 1: 创建FileAttributes.tsx

创建 `client/src/components/drive/FileAttributes.tsx` 文件：

```typescript
import { memo } from 'react'
import type { DriveItem } from '../../types/drive'
import { formatFileSize, formatDate } from '../../lib/format'

export interface FileAttributesProps {
  item: DriveItem
}

const FileAttributes = memo(function FileAttributes({ item }: FileAttributesProps) {
  const getFileInfo = () => {
    const info: { label: string; value: string }[] = []

    // 基本信息
    if (!item.isFolder) {
      info.push({ label: '大小', value: formatFileSize(Number(item.size)) })
    }

    if (item.mimeType) {
      info.push({ label: 'MIME 类型', value: item.mimeType })
    }

    info.push({ label: '创建时间', value: formatDate(item.createdAt) })
    info.push({ label: '修改时间', value: formatDate(item.updatedAt) })

    if (item.uploadedBy) {
      info.push({ label: '上传者', value: item.uploadedBy.username })
    }

    // 图片特有信息
    const mime = (item.mimeType || '').toLowerCase()
    const ext = item.name.split('.').pop()?.toLowerCase() || ''

    if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
      info.push({ label: '类型', value: '图片' })
    }

    // 视频特有信息
    if (mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) {
      info.push({ label: '类型', value: '视频' })
    }

    // 音频特有信息
    if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac'].includes(ext)) {
      info.push({ label: '类型', value: '音频' })
    }

    // 文档特有信息
    if (['pdf'].includes(ext)) {
      info.push({ label: '类型', value: 'PDF 文档' })
    } else if (['doc', 'docx'].includes(ext)) {
      info.push({ label: '类型', value: 'Word 文档' })
    } else if (['xls', 'xlsx'].includes(ext)) {
      info.push({ label: '类型', value: 'Excel 表格' })
    } else if (['ppt', 'pptx'].includes(ext)) {
      info.push({ label: '类型', value: 'PPT 演示' })
    }

    // 压缩包特有信息
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
      info.push({ label: '类型', value: '压缩包' })
    }

    // 代码文件特有信息
    if (['js', 'ts', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'html', 'css'].includes(ext)) {
      info.push({ label: '类型', value: '代码文件' })
    }

    return info
  }

  const fileInfo = getFileInfo()

  return (
    <div className="file-attributes">
      <h4 className="file-attributes-heading">文件信息</h4>
      <div className="file-attributes-list">
        {fileInfo.map((info, index) => (
          <div key={index} className="file-attribute-row">
            <span className="file-attribute-label">{info.label}</span>
            <span className="file-attribute-value">{info.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
})

export default FileAttributes
```

### Step 2: 更新DriveDetailPanel.tsx

修改 `client/src/components/drive/DriveDetailPanel.tsx` 文件：
- 导入FileAttributes组件
- 使用FileAttributes显示文件属性
- 优化预览区域显示
- 添加更多操作按钮

### Step 3: 添加FileAttributes样式到drive.css

在 `client/src/styles/drive.css` 文件中添加文件属性样式：
- .file-attributes
- .file-attributes-heading
- .file-attributes-list
- .file-attribute-row
- .file-attribute-label
- .file-attribute-value

### Step 4: 运行TypeScript检查

Run: `cd client && npx tsc --noEmit`
Expected: 无类型错误

### Step 5: 提交代码

```bash
git add client/src/components/drive/DriveDetailPanel.tsx client/src/components/drive/FileAttributes.tsx client/src/styles/drive.css
git commit -m "feat(drive): optimize detail panel with file attributes"
```

## Global Constraints
- 保持Liquid Glass设计语言
- 所有现有功能必须正常工作

## 注意事项
- 使用useDrive hook获取选中文件状态
- 显示文件基本信息（大小、类型、时间、上传者）
- 根据文件类型显示特有信息
- 优化预览区域显示
- 使用memo包装组件避免不必要的重渲染