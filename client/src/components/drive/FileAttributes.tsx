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