package request

type UploadRequest struct {
	ReferenceID string `form:"reference_id" binding:"required,uuid"`
	Pages       string `form:"pages"` // optional JSON: "[1,2,3,4]"
}

type UploadURLRequest struct {
	ReferenceID string `form:"reference_id" binding:"required,uuid"`
	URL         string `form:"url" binding:"required,url"`
	CrawlBFS    bool   `form:"crawl_bfs"`
	MaxPages    int    `form:"max_pages"`
}

type GetFileRequest struct {
	ID string `json:"id" binding:"required"`
}

type ListFileRequest struct {
	ReferenceID string `form:"reference_id" binding:"required"`
}

type DeleteFileRequest struct {
	ID string `json:"id" binding:"required"`
}
