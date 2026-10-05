interface BookLike {
  origin?: string
  bookUrl?: string
  originName?: string
  kind?: string
  tocUrl?: string
}

export function isLocalTxtBook(book?: BookLike | null): boolean {
  if (!book) return false
  const origin = (book.origin || '').trim().toLowerCase()
  const url = (book.bookUrl || '').trim().toLowerCase()
  const toc = (book.tocUrl || '').trim().toLowerCase()
  const kind = (book.kind || '').trim().toLowerCase()
  const originName = (book.originName || '').trim().toLowerCase()

  return (
    origin === 'local-txt' ||
    origin === 'txt' ||
    url.startsWith('local-txt:') ||
    url.endsWith('.txt') ||
    url.includes('.txt#') ||
    toc.endsWith('.txt') ||
    kind.includes('txt') ||
    (origin === 'local' && (url.endsWith('.txt') || originName.includes('txt') || kind.includes('txt')))
  )
}

export function isLocalEpubBook(book?: BookLike | null): boolean {
  if (!book) return false
  const origin = (book.origin || '').trim().toLowerCase()
  const url = (book.bookUrl || '').trim().toLowerCase()
  const toc = (book.tocUrl || '').trim().toLowerCase()
  const kind = (book.kind || '').trim().toLowerCase()
  const originName = (book.originName || '').trim().toLowerCase()

  return (
    origin === 'local-epub' ||
    origin === 'epub' ||
    url.startsWith('local-epub:') ||
    url.endsWith('.epub') ||
    url.includes('.epub#') ||
    toc.endsWith('.epub') ||
    kind.includes('epub') ||
    (origin === 'local' && (url.endsWith('.epub') || originName.includes('epub') || kind.includes('epub')))
  )
}

export function isLocalPdfBook(book?: BookLike | null): boolean {
  if (!book) return false
  const origin = (book.origin || '').trim().toLowerCase()
  const url = (book.bookUrl || '').trim().toLowerCase()
  const toc = (book.tocUrl || '').trim().toLowerCase()
  const kind = (book.kind || '').trim().toLowerCase()
  const originName = (book.originName || '').trim().toLowerCase()

  return (
    origin === 'local-pdf' ||
    origin === 'pdf' ||
    url.startsWith('local-pdf:') ||
    url.endsWith('.pdf') ||
    url.includes('.pdf#') ||
    toc.endsWith('.pdf') ||
    kind.includes('pdf') ||
    (origin === 'local' && (url.endsWith('.pdf') || originName.includes('pdf') || kind.includes('pdf')))
  )
}

export function isLocalBook(book?: BookLike | null): boolean {
  if (!book) return false
  return isLocalTxtBook(book) || isLocalEpubBook(book) || isLocalPdfBook(book)
}
