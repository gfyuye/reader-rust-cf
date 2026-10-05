interface BookLike {
  origin?: string
  bookUrl?: string
  originName?: string
  kind?: string
  tocUrl?: string
  name?: string
}

function matchesFormat(book: BookLike | null | undefined, ext: 'txt' | 'epub' | 'pdf'): boolean {
  if (!book) return false
  const origin = (book.origin || '').trim().toLowerCase()
  const url = (book.bookUrl || '').trim().toLowerCase()
  const toc = (book.tocUrl || '').trim().toLowerCase()
  const kind = (book.kind || '').trim().toLowerCase()
  const originName = (book.originName || '').trim().toLowerCase()
  const name = (book.name || '').trim().toLowerCase()

  const pattern = `.${ext}`
  const encodedPattern = `%2e${ext}`
  const localProto = `local-${ext}`

  return (
    origin === localProto ||
    origin === ext ||
    origin.startsWith(`${localProto}:`) ||
    (origin.startsWith('webdav::') && (origin.includes(pattern) || origin.includes(encodedPattern))) ||
    url.startsWith(`${localProto}:`) ||
    url.includes(pattern) ||
    url.includes(encodedPattern) ||
    (url.startsWith('content://') && (url.includes(pattern) || url.includes(encodedPattern))) ||
    toc.includes(pattern) ||
    toc.includes(encodedPattern) ||
    originName.includes(pattern) ||
    originName.includes(encodedPattern) ||
    name.includes(pattern) ||
    name.includes(encodedPattern) ||
    kind.includes(ext) ||
    (origin === 'local' && (originName.includes(pattern) || url.includes(pattern) || name.includes(pattern)))
  )
}

export function isLocalTxtBook(book?: BookLike | null): boolean {
  return matchesFormat(book, 'txt')
}

export function isLocalEpubBook(book?: BookLike | null): boolean {
  return matchesFormat(book, 'epub')
}

export function isLocalPdfBook(book?: BookLike | null): boolean {
  return matchesFormat(book, 'pdf')
}

export function isLocalBook(book?: BookLike | null): boolean {
  if (!book) return false
  return isLocalTxtBook(book) || isLocalEpubBook(book) || isLocalPdfBook(book)
}
