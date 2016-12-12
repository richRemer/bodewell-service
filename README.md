Bodewell Service
================
This package exports the Bodewell `Service` class used by the Bodewell server
and related plugins.

```js
const Service = require("bodewell-service");

var service = new Service();
service.start();
process.on("SIGINT", () => service.stop());
```
