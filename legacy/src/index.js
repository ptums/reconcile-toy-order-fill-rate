require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const methodOverride = require('method-override');
const fileUpload = require('express-fileupload');
const exphbs = require('express-handlebars');
const fs = require('fs');
const {
  promisify,
} = require('util');
const readIncomingSheet = require('./parse-sheet');
const { formatDate, chunkRecords } = require('../utils/helpers');
const handleRegularOrders = require('./regular-orders');
const db = require('./models');

const PORT = process.env.PORT || 8200;
const app = express();
const writeFileAsync = promisify(fs.writeFile);
const hbs = exphbs.create({ formatDate });

/** Connect to mongoose */
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

/** Set up Express middleware */
app.use(express.json());
app.use(express.urlencoded({
  extended: true,
}));
app.use(methodOverride('_method'));
app.use(fileUpload());

/** Set up handlebars templating */
app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');

app.get('/', (_, res) => {
  res.render('index');
});

/** Results route & template */
app.get('/results', (_, res) => {
  res.render('results');
});

/** * Order processing route */
app.post('/api/parse-csv', async (req, res) => {
  try {
    /** Delete all records in the database * */
    await db.Failures.deleteMany({});
    await db.Success.deleteMany({});

    /** Start organzing the CSV processing * */
    req.connection.setTimeout(2147483647);
    console.time('Processing time');
    const csvFile = req.files.uploadCSV.data.toString('utf8');
    const tempFile = `${__dirname}/../storage/temp.csv`;
    const used = process.memoryUsage().heapUsed / 1024 / 1024;

    await writeFileAsync(tempFile, csvFile, 'utf8', (err) => {
      if (err) {
        const error = new Error(err);
        console.log('Error reading the csv file...');
        console.log('--------------------------------------');
        console.error(error);

        return res.redirect('/results');
      }
      fs.createReadStream(tempFile).on('data', async (row) => {
        const records = await readIncomingSheet(row);

        // we need to break this array into chuncks
        // then do the following process
        // chunkRecords
        if (records.length > 20) {
          const chunked = chunkRecords(records, 20);
          console.info(`# Total chunks: ${chunked.length}`);
          console.info('==================');

          for (let i = 0; i < chunked.length; i += 1) {
            console.info(`# Chunk: ${i + 1}`);
            console.log('==============');
            console.log(`Items in chunk ${i + 1}: ${chunked[i].length}`);
            console.log('============');
            await handleRegularOrders(chunked[i]);

            if (i === chunked.length - 1) {
              console.info(`The script uses approximately ${Math.round(used * 100) / 100} MB`);
              console.timeEnd('Processing time');
              return res.redirect('/results');
            }
          }
        }

        if (records.length <= 20) {
          console.info(`# Records to process: ${records.length}`);
          console.info('=========================');

          const processOrders = await handleRegularOrders(records);
          if (processOrders.status === 201) {
            console.info(`The script uses approximately ${Math.round(used * 100) / 100} MB`);
            console.timeEnd('Processing time');
            return res.redirect('/results');
          }
        }
      });
    });
  } catch (err) {
    const error = new Error(err);
    console.log('Error in POST request...');
    console.log('--------------------------------------');
    console.error(error);

    return res.redirect('/results');
  }
});

// get all the response from the processed orders
app.get('/order-results', async (_, res) => {
  const failures = await db.Failures.find({});
  const success = await db.Success.find({});

  return res.json({
    failures,
    success,
  });
});

app.listen(PORT, () => {
  console.log(`server running on port: ${PORT}`);
});
