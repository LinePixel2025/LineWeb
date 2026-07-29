import { memo } from 'react'
import type { DriveItem } from '../../types/drive'
import { formatFileSize, formatDate } from '../../lib/format'

export interface FileAttributesProps {
  item: DriveItem
}

const FileAttributes = memo(function FileAttributes({ item }: FileAttributesProps) {
  const getFileInfo = () => {
    const info: { label: string; value: string }[] = []

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

    const mime = (item.mimeType || '').toLowerCase()
    const ext = item.name.split('.').pop()?.toLowerCase() || ''

    if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
      info.push({ label: '类型', value: '图片' })
    }

    if (mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) {
      info.push({ label: '类型', value: '视频' })
    }

    if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac'].includes(ext)) {
      info.push({ label: '类型', value: '音频' })
    }

    if (['pdf'].includes(ext)) {
      info.push({ label: '类型', value: 'PDF 文档' })
    } else if (['doc', 'docx'].includes(ext)) {
      info.push({ label: '类型', value: 'Word 文档' })
    } else if (['xls', 'xlsx'].includes(ext)) {
      info.push({ label: '类型', value: 'Excel 表格' })
    } else if (['ppt', 'pptx'].includes(ext)) {
      info.push({ label: '类型', value: 'PPT 演示' })
    }

    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
      info.push({ label: '类型', value: '压缩包' })
    }

    if (['js', 'ts', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'html', 'css'].includes(ext)) {
      info.push({ label: '类型', value: '代码文件' })
    }

    return info
  }

  const fileInfo = getFileInfo()

  return (
    <div className="gh-drive-file-attributes">
      <h4 className="gh-drive-file-attributes-heading">文件信息</h4>
      <div>
        {fileInfo.map((info, index) => (
          <div key={index} className="gh-drive-file-attribute-row">
            <span className="gh-drive-file-attribute-label">{info.label}</span>
            <span className="gh-drive-file-attribute-value">{info.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
})

export default FileAttributes
