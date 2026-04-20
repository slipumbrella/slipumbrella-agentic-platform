package request

type UpsertOpenRouterModelRequest struct {
	ID            string   `json:"id"             form:"id"             binding:"required"`
	Name          string   `json:"name"           form:"name"           binding:"required"`
	Tags          []string `json:"tags"           form:"tags"`
	SelectionHint string   `json:"selection_hint" form:"selection_hint"`
	AdvancedInfo  string   `json:"advanced_info"  form:"advanced_info"`
	Description   string   `json:"description"    form:"description"`
	ContextLength int      `json:"context_length" form:"context_length"`
	InputPrice    float64  `json:"input_price"    form:"input_price"`
	OutputPrice   float64  `json:"output_price"   form:"output_price"`
	IsReasoning   bool     `json:"is_reasoning"   form:"is_reasoning"`
	IsActive      bool     `json:"is_active"      form:"is_active"`
	Icon          string   `json:"icon"           form:"icon"`
}
