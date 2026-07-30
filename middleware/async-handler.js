// Express 异步路由错误处理包装器
// 让 async 路由中的异常自动被全局错误处理器捕获
const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { asyncHandler };
