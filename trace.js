// export const load = async (url, context, defaultLoad) => {
//   const start = process.hrtime.bigint()
//   try {
//     return await defaultLoad(url, context)
//   } finally {
//     const end = process.hrtime.bigint()
//     console.log(`${end - start} ${url}`)
//   }
// }
