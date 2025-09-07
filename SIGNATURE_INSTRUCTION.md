## Locating PAQ Document Client Initials

- On the PAQ documents client initials are found to the right of the "Client Initial" label at the bottom left of the page.
- To locate the area to evaluate for the presence of a signature mark I am going to reference the file debug_boxes_grouped_by_page.json:
  - On page 0 we will use fuse.js to locate the following boxes to establish the space between them as the eligible area to find signature marks:
    - First we locate the "Case Reference no" box I have pasted below:
    - ```json
       {
        "text": "Case reference no",
        "x": 17.92,
        "y": 761.333,
        "width": 70.31199999999998,
        "height": 8,
        "pageIndex": 0,
        "pageWidth": 595.276,
        "pageHeight": 841.89,
        "boxIndex": 5,
        "source": "pdf"
      }
      ```
    - Next we locate the "Client initial" box I have pasted below and now we have the top and bottom left edges of our space:
    - ```json
      {
        "text": "Client initial",
        "x": 17.92,
        "y": 799.116,
        "width": 46.56800000000001,
        "height": 8,
        "pageIndex": 0,
        "pageWidth": 595.276,
        "pageHeight": 841.89,
        "boxIndex": 20,
        "source": "pdf"
      }
      
      ```
    - Next we need the right bound edges of our signature box so using a fuzzy proximity search from our "Case Reference no" box we look for the "Merchant/Consultant no" box to the right I have pasted below:
    - ```json
      {
        "text": "Merchant/Consultant no",
        "x": 298.964,
        "y": 760.239,
        "width": 96.75200000000001,
        "height": 8,
        "pageIndex": 0,
        "pageWidth": 595.276,
        "pageHeight": 841.89,
        "boxIndex": 9,
        "source": "pdf"
      }
      ```
    - These 3 boxes are enough, the "Merchant/Consultant no" just gives us our right bounds.
    - Now lets build our signature box
    - I will take the x and y from our "Case reference no" box
    - I will take the y + height from our "Client initial" box to get our lowest y
    - I will take the x from our "Merchant/Consultant no", minus the x value of our "Case reference no" to get the width
    - I will subtract the y value of our "Case reference no" box from the y value we calculated from the "Client intial" y + height
    - Our final box should look something like:
    - ```json
      {
        "x":17.92,
        "y":761.333,
        "width":281.044,
        "height":45.783
      }
      ```


## Locating PAQ Document Client Signature

- Finding the signature areas is not as precise as the initials - there is more guess work here
- First we fuzzy find the last box with "Client Signature" in it with a proximity to "Place", from our debug_boxes_grouped_by_page.json that signature box is a little odd, looks like it was merged incorrectly with nearby boxes but its good enough to find a starting point:
  - ```json
    {
        "text": "Client Signature - the security, if any, you gave us or that was given to us on your behalf in terms of the agreement.",
        "x": 19.336,
        "y": 127.06700000000001,
        "width": 393.4770000000003,
        "height": 7,
        "pageIndex": 5,
        "pageWidth": 595.276,
        "pageHeight": 841.89,
        "boxIndex": 29,
        "source": "pdf"
      }
    
    ```
  - Now we take the page width, divide it in half to get our right bounds and give ourselves a 10 - 12% of the overall page height as our area box, which would look something like:
    - ```json
      {
        "x":19.336,
        "y": 167,
        "width": 290,
        "height": 80
      }
      ```