import { readMultipartFormData } from 'h3'
import { checkUploadContent } from '~~/server/services/file/contentSniffer'
import { FileService, useFileManagerConfig } from '~~/server/services/file/fileService'
import { RateLimitUnavailableError, UploadRateLimiter } from '~~/server/services/file/rateLimiter'
import { createStorageProvider } from '~~/server/services/file/storage/factory'
import {
  checkDeclaredBodyLength,
  maxUploadBodySize,
  resolveAllowedMimeTypes,
  resolveMaxFileSize
} from '~~/server/services/file/uploadPolicy'

export default defineEventHandler(async (event) => {
  const config = useFileManagerConfig()
  const maxFileSize = resolveMaxFileSize(config.maxFileSize)
  const allowedMimeTypes = resolveAllowedMimeTypes(config.allowedMimeTypes)

  const user = await requireAuth(event)

  // Refuse before buffering: h3 reads the whole body into memory.
  const bodyLength = checkDeclaredBodyLength(
    getRequestHeader(event, 'content-length'),
    getRequestHeader(event, 'transfer-encoding'),
    maxUploadBodySize(maxFileSize)
  )
  if (!bodyLength.ok) {
    throw createError(bodyLength.statusCode === 411
      ? { statusCode: 411, statusMessage: 'Content-Length required' }
      : { statusCode: 413, statusMessage: `Upload exceeds maximum allowed size of ${formatFileSize(maxFileSize)}` })
  }

  // Counts every attempt that passes the length check, valid or not.
  if (config.uploadRateLimit) {
    const { maxUploadsPerWindow, windowSizeMinutes } = config.uploadRateLimit
    const rateLimiter = new UploadRateLimiter(windowSizeMinutes, maxUploadsPerWindow)

    let result
    try {
      result = await rateLimiter.checkAndIncrement(user.id)
    } catch (error) {
      if (error instanceof RateLimitUnavailableError) {
        throw createError({
          statusCode: 503,
          statusMessage: 'Upload temporarily unavailable, please retry later'
        })
      }
      throw error
    }

    if (!result.allowed) {
      throw createError({
        statusCode: 429,
        statusMessage: `Upload rate limit exceeded. Maximum ${maxUploadsPerWindow} uploads per ${windowSizeMinutes} minutes. Current count: ${result.currentCount}`
      })
    }
  }

  const formData = await readMultipartFormData(event)
  if (!formData) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No files provided'
    })
  }

  // Limit to single file upload
  const validFiles = formData.filter(fileData => fileData.data && fileData.filename)
  if (validFiles.length > 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Only one file can be uploaded at a time'
    })
  }
  if (validFiles.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No files provided'
    })
  }

  const storageProvider = await createStorageProvider(config.storage)
  const fileService = new FileService(storageProvider)

  const fileData = validFiles[0]!

  const fileSize = fileData.data.length

  // Validate file size
  if (fileSize > maxFileSize) {
    throw createError({
      statusCode: 413,
      statusMessage: `File size exceeds maximum allowed size of ${formatFileSize(maxFileSize)}`
    })
  }

  // The declared type is client input: the bytes decide.
  const content = checkUploadContent(fileData.type, fileData.data, allowedMimeTypes)
  if (!content.ok) {
    throw createError({
      statusCode: 415,
      statusMessage: 'File type is not allowed or does not match its content.'
    })
  }

  try {
    const file = await fileService.uploadFile(
      fileData.data,
      fileData.filename!,
      content.type,
      user.id,
      getRequestIP(event),
      getHeader(event, 'user-agent')
    )
    return {
      success: true,
      file
    }
  } catch (error) {
    console.error(error)
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : 'Upload failed'
    })
  }
})
