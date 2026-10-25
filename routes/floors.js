const express = require('express');
const authMiddleware = require('../config/auth.middleware');
const { query } = require('../config/database');
const toCamel = require('../utils').toCamel;

const router = express.Router();

// floors route
router.get('/get-floors', authMiddleware, async (req, res) => {
  try {
    // auth middleware sets the search_path to the tenant schema, so unqualified table names will resolve correctly
    const result = await query('SELECT * FROM floor');
    const mappedRows = result.rows.map(toCamel);
    return res.status(200).json({ message: 'Floors Fetched Successfully' , floors: mappedRows });
  } catch (err) {
    console.error('Error fetching floors:', err);
    return res.status(500).json({ message: 'Error fetching floors' });
  } 
});

router.get('/get-floor/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await query( 'SELECT * FROM floor WHERE floor_id = $1', [id]);

    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Floor not found' });
    const row = toCamel(result.rows[0])
    return res.status(200).json({ message: 'Floor Fetched Successfully' , floor: row });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching floor' });
  } 
});


router.post('/add-floor', authMiddleware, async (req, res) => {
  const { floorNumber, totalRooms } = req.body;

  try {
    const result = await query(
      `INSERT INTO floor (floor_no, total_rooms) VALUES ($1, $2)
       RETURNING *`,
      [floorNumber, totalRooms]
    );

    res.status(201).json({
      status: 'success',
      message: 'Floor added successfully',
      floor: toCamel(result.rows[0])
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ status:'fail',message: 'Error adding floor' });
  } 
});


router.put('/update-floor/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { floorNumber, totalRooms } = req.body;

  try {
    const result = await query(
      `UPDATE floor
       SET floor_no = $1,
           total_rooms = $2
       WHERE floor_id = $3
       RETURNING *`,
      [floorNumber, totalRooms, id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Floor not found' });

    res.json({
      status: 'success',
      message: 'Floor updated successfully',
      floor: toCamel(result.rows[0])
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({status:'fail',message: 'Error updating floor' });
  }
});


router.delete('/delete-floor/:id', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  const { id } = req.params;

  try {
    const result = await client.query(
      'DELETE FROM floor WHERE floor_id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Floor not found' });

    res.json({ message: 'Floor deleted successfully' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error deleting floor' });
  } finally {
    client.release();
  }
});



module.exports = router;