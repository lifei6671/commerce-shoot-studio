package constant

// ModelCategory 是模型能力类别的持久化类型。
type ModelCategory uint8

// 稳定的模型能力类别值。
const (
	ModelCategoryTextToText   ModelCategory = 1
	ModelCategoryTextToImage  ModelCategory = 2
	ModelCategoryImageToImage ModelCategory = 3
	ModelCategoryImageToText  ModelCategory = 4
)
